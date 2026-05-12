package serviceclient

import (
	"context"
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	defaultMaxAttempts    = 1
	defaultRetryBackoff   = 100 * time.Millisecond
	jitterDivisor         = 2
	unixSocketDialTimeout = 10 * time.Second
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
	maxAttempts = max(maxAttempts, defaultMaxAttempts)
	backoff := cfg.RetryBackoff
	if backoff == 0 {
		backoff = defaultRetryBackoff
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
	for attempt := range t.maxAttempts {
		attemptReq, err := cloneRequest(req, attempt)
		if err != nil {
			return nil, err
		}

		setHeaders(attemptReq)

		resp, err := t.roundTrip(attemptReq, attempt)
		if err != nil {
			lastErr = err
			if err := t.waitAfterError(req, attempt, err); err != nil {
				return nil, err
			}
			continue
		}

		if t.shouldRetry(req, attempt, resp, nil) {
			closeErr := resp.Body.Close()
			if closeErr != nil {
				return nil, fmt.Errorf("close retry response body: %w", closeErr)
			}
			if err := t.wait(req.Context(), attempt); err != nil {
				return nil, err
			}
			continue
		}

		return resp, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("request failed without response")
}

func (t retryTransport) waitAfterError(req *http.Request, attempt int, err error) error {
	if !t.shouldRetry(req, attempt, nil, err) {
		return err
	}
	return t.wait(req.Context(), attempt)
}

func (t retryTransport) roundTrip(req *http.Request, attempt int) (*http.Response, error) {
	return otelhttp.NewTransport(t.base, otelhttp.WithSpanOptions(
		trace.WithAttributes(semconv.HTTPRequestResendCount(attempt)),
	)).RoundTrip(req)
}

func baseTransport(cfg Config) http.RoundTripper {
	defaultTransport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return http.DefaultTransport
	}

	transport := defaultTransport.Clone()
	if cfg.UnixSocketPath != "" {
		dialer := net.Dialer{Timeout: unixSocketDialTimeout}
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

func setHeaders(req *http.Request) {
	if key := IdempotencyKey(req.Context()); key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
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
	timer := time.NewTimer(delay + randomJitter(delay/jitterDivisor))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func randomJitter(maxDelay time.Duration) time.Duration {
	if maxDelay <= 0 {
		return 0
	}
	jitter, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(maxDelay)))
	if err != nil {
		return 0
	}
	return time.Duration(jitter.Int64())
}
