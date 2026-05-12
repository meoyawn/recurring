package serviceclient

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	retryBackoff       = time.Nanosecond
	unixRetryAttempts  = 5
	unixRetryBackoff   = time.Millisecond
	unixClientTimeout  = time.Second
	serverStartDelay   = 3 * time.Millisecond
	requestTimeout     = time.Second
	readHeaderTimeout  = time.Second
	randomSuffixLength = 8
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestRetryablePostRetriesAndAddsIdempotencyKey(t *testing.T) {
	t.Parallel()

	var attempts int
	transport := NewTransport(
		Config{MaxAttempts: 2, RetryBackoff: retryBackoff},
		roundTripFunc(func(req *http.Request) (*http.Response, error) {
			attempts++
			if got := req.Header.Get("Idempotency-Key"); got != "export-1" {
				t.Fatalf("Idempotency-Key = %q, want export-1", got)
			}
			if attempts == 1 {
				return nil, errors.New("dial failed")
			}
			return &http.Response{
				StatusCode: http.StatusCreated,
				Status:     "201 Created",
				Body:       io.NopCloser(strings.NewReader("ok")),
				Header:     http.Header{},
				Request:    req,
			}, nil
		}),
	)
	client := http.Client{Transport: transport}

	ctx := WithRetryable(context.Background(), true)
	ctx = WithIdempotencyKey(ctx, "export-1")
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://service/exports/workbook",
		strings.NewReader("body"),
	)
	if err != nil {
		t.Fatal(err)
	}
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("body")), nil
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
}

func TestPostWithoutRetryableContextDoesNotRetry(t *testing.T) {
	t.Parallel()

	var attempts int
	transport := NewTransport(
		Config{MaxAttempts: 2, RetryBackoff: retryBackoff},
		roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			attempts++
			return nil, errors.New("dial failed")
		}),
	)
	client := http.Client{Transport: transport}

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"http://service/exports/workbook",
		strings.NewReader("body"),
	)
	if err != nil {
		t.Fatal(err)
	}

	resp, err := client.Do(req)
	if resp != nil && resp.Body != nil {
		defer func() {
			_ = resp.Body.Close()
		}()
	}
	if err == nil {
		t.Fatal("expected request error")
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestRequestRetriesUntilUnixSocketServerStarts(t *testing.T) {
	t.Parallel()

	setTestTracerProvider(t)

	socketPath := filepath.Join("/tmp", "recurring-serviceclient-"+randomSuffix()+".sock")
	t.Cleanup(func() {
		_ = os.Remove(socketPath)
	})
	requests := make(chan http.Header, 1)

	ctx, span := otel.Tracer("serviceclient-test").Start(context.Background(), "parent")
	defer span.End()
	req := newWorkbookRequest(ctx, t, "export-2")

	errc := make(chan error, 1)
	go runClientRequest(retryingUnixClient(socketPath), req, errc)

	time.Sleep(serverStartDelay)
	server := startUnixHTTPServer(t, socketPath, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		requests <- req.Header.Clone()
		w.WriteHeader(http.StatusCreated)
	}))
	defer func() {
		_ = server.Close()
		_ = os.Remove(socketPath)
	}()

	select {
	case err := <-errc:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("request did not complete")
	}

	select {
	case headers := <-requests:
		if got := headers.Get("Idempotency-Key"); got != "export-2" {
			t.Fatalf("Idempotency-Key = %q, want export-2", got)
		}
		if got := headers.Get("Traceparent"); got == "" {
			t.Fatal("Traceparent header is empty")
		}
	default:
		t.Fatal("server did not receive request")
	}
}

func setTestTracerProvider(t *testing.T) {
	t.Helper()

	otel.SetTextMapPropagator(propagation.TraceContext{})
	provider := sdktrace.NewTracerProvider()
	t.Cleanup(func() {
		_ = provider.Shutdown(context.WithoutCancel(t.Context()))
	})
	otel.SetTracerProvider(provider)
}

func retryingUnixClient(socketPath string) http.Client {
	transport := NewTransport(Config{
		UnixSocketPath: socketPath,
		MaxAttempts:    unixRetryAttempts,
		RetryBackoff:   unixRetryBackoff,
	}, nil)
	return http.Client{
		Transport: transport,
		Timeout:   unixClientTimeout,
	}
}

func newWorkbookRequest(ctx context.Context, t *testing.T, idempotencyKey string) *http.Request {
	t.Helper()

	ctx = WithRetryable(ctx, true)
	ctx = WithIdempotencyKey(ctx, idempotencyKey)
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://service/exports/workbook",
		strings.NewReader("body"),
	)
	if err != nil {
		t.Fatal(err)
	}
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(strings.NewReader("body")), nil
	}
	return req
}

func runClientRequest(client http.Client, req *http.Request, errc chan<- error) {
	resp, err := client.Do(req)
	if err != nil {
		errc <- err
		return
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusCreated {
		errc <- errors.New(resp.Status)
		return
	}
	errc <- nil
}

func startUnixHTTPServer(t *testing.T, socketPath string, handler http.Handler) *http.Server {
	t.Helper()

	listenConfig := net.ListenConfig{}
	listener, err := listenConfig.Listen(t.Context(), "unix", socketPath)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Errorf("serve unix socket: %v", err)
		}
	}()
	return server
}

func randomSuffix() string {
	var bytes [randomSuffixLength]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes[:])
}
