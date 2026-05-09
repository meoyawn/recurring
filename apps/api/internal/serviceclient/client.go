package serviceclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

type Config struct {
	UnixSocketPath string
	Timeout        time.Duration
	MaxAttempts    int
	RetryBackoff   time.Duration
}

type retryTransport struct {
	base        http.RoundTripper
	maxAttempts int
	backoff     time.Duration
}

type spanBody struct {
	io.ReadCloser
	span trace.Span
}

func NewHTTPClient(cfg Config) *http.Client {
	return &http.Client{
		Timeout:   cfg.Timeout,
		Transport: NewTransport(cfg, nil),
	}
}

func NewTransport(cfg Config, base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = baseTransport(cfg)
	}
	maxAttempts := cfg.MaxAttempts
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	backoff := cfg.RetryBackoff
	if backoff == 0 {
		backoff = 100 * time.Millisecond
	}
	return retryTransport{
		base:        base,
		maxAttempts: maxAttempts,
		backoff:     backoff,
	}
}

func (t retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Body != nil && req.GetBody == nil && canRetry(req) {
		return nil, errors.New("retryable request body cannot be replayed")
	}

	var lastErr error
	for attempt := 0; attempt < t.maxAttempts; attempt++ {
		attemptReq, err := cloneRequest(req, attempt)
		if err != nil {
			return nil, err
		}

		spanCtx, span := startAttemptSpan(attemptReq, attempt)
		attemptReq = attemptReq.WithContext(spanCtx)
		injectHeaders(attemptReq)

		resp, err := t.base.RoundTrip(attemptReq)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.End()
			lastErr = err
			if !t.shouldRetry(req, attempt, nil, err) {
				return nil, err
			}
			if err := t.wait(req.Context(), attempt); err != nil {
				return nil, err
			}
			continue
		}

		span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
		if t.shouldRetry(req, attempt, resp, nil) {
			span.SetStatus(codes.Error, resp.Status)
			closeErr := resp.Body.Close()
			span.End()
			if closeErr != nil {
				return nil, fmt.Errorf("close retry response body: %w", closeErr)
			}
			if err := t.wait(req.Context(), attempt); err != nil {
				return nil, err
			}
			continue
		}

		if resp.Body == nil {
			span.End()
			return resp, nil
		}
		resp.Body = spanBody{ReadCloser: resp.Body, span: span}
		return resp, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("request failed without response")
}

func baseTransport(cfg Config) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if cfg.UnixSocketPath != "" {
		dialer := net.Dialer{Timeout: 10 * time.Second}
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "unix", cfg.UnixSocketPath)
		}
	}
	return transport
}

func cloneRequest(req *http.Request, attempt int) (*http.Request, error) {
	clone := req.Clone(req.Context())
	if attempt > 0 && req.GetBody != nil {
		body, err := req.GetBody()
		if err != nil {
			return nil, fmt.Errorf("reset request body for retry: %w", err)
		}
		clone.Body = body
	}
	return clone, nil
}

func startAttemptSpan(req *http.Request, attempt int) (context.Context, trace.Span) {
	tracer := otel.Tracer("github.com/recurring/api/internal/serviceclient")
	ctx, span := tracer.Start(req.Context(), req.Method+" "+req.URL.Host, trace.WithSpanKind(trace.SpanKindClient))
	span.SetAttributes(
		attribute.String("http.request.method", req.Method),
		attribute.String("url.full", req.URL.String()),
		attribute.Int("http.request.resend_count", attempt),
	)
	return ctx, span
}

func injectHeaders(req *http.Request) {
	if key := IdempotencyKey(req.Context()); key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	otel.GetTextMapPropagator().Inject(req.Context(), propagation.HeaderCarrier(req.Header))
}

func (t retryTransport) shouldRetry(req *http.Request, attempt int, resp *http.Response, err error) bool {
	if attempt+1 >= t.maxAttempts {
		return false
	}
	if !canRetry(req) {
		return false
	}
	if err != nil {
		return true
	}
	return resp != nil && retryableStatus(resp.StatusCode)
}

func canRetry(req *http.Request) bool {
	if Retryable(req.Context()) {
		return true
	}
	switch req.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

func retryableStatus(status int) bool {
	switch status {
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func (t retryTransport) wait(ctx context.Context, attempt int) error {
	delay := t.backoff * time.Duration(1<<attempt)
	var jitter time.Duration
	if delay > time.Nanosecond {
		jitter = time.Duration(rand.Int64N(int64(delay / 2)))
	}
	timer := time.NewTimer(delay + jitter)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (b spanBody) Close() error {
	err := b.ReadCloser.Close()
	if err != nil {
		b.span.RecordError(err)
		b.span.SetStatus(codes.Error, err.Error())
	}
	b.span.End()
	return err
}
