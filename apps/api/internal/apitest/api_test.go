package apitest

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/recurring/api/internal/app"
	"github.com/recurring/api/internal/config"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/httpapi"
	"github.com/recurring/api/pkg/pgdocker"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"gotest.tools/v3/assert"
)

var apiBaseURL string
var sessionIDPattern = regexp.MustCompile(`^sess_[0-9a-f]{32}$`)

type signupPayload struct {
	GoogleSub  string  `json:"google_sub"`
	Email      string  `json:"email"`
	Name       *string `json:"name,omitempty"`
	PictureURL *string `json:"picture_url,omitempty"`
}

type signupSessionResponse struct {
	SessionID string `json:"session_id"`
}

type testEnv struct {
	postgres *pgdocker.Container
	server   *app.Server
	sheets   *childProcess
	tempDir  string
}

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	devConfig, err := config.Load(filepath.Join("..", "..", "config", "dev.yaml"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "load dev config: %v\n", err)
		return 1
	}

	env, err := startTestEnv(ctx, devConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start api test environment: %v\n", err)
		return 1
	}

	code := m.Run()

	if err := env.Close(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		code = 1
	}
	return code
}

func startTestEnv(ctx context.Context, devConfig configgen.Config) (*testEnv, error) {
	container, err := pgdocker.Start(ctx, postgresConfig(devConfig.Db))
	if err != nil {
		return nil, fmt.Errorf("start postgres: %w", err)
	}

	tempDir, err := os.MkdirTemp("/tmp", "recurring-apitest-*")
	if err != nil {
		_ = container.Close(context.Background())
		return nil, fmt.Errorf("create temp dir: %w", err)
	}

	sheetsSocketPath, err := randomSocketPath(tempDir)
	if err != nil {
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.Background())
		return nil, err
	}
	sheets, err := startSheets(ctx, sheetsSocketPath)
	if err != nil {
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.Background())
		return nil, err
	}
	if err := waitForSheets(ctx, sheetsSocketPath, sheets); err != nil {
		_ = stopChild(context.Background(), sheets)
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.Background())
		return nil, err
	}

	server, err := startAPI(ctx, devConfig, container, sheetsSocketPath)
	if err != nil {
		_ = stopChild(context.Background(), sheets)
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.Background())
		return nil, fmt.Errorf("start api: %w", err)
	}
	return &testEnv{postgres: container, server: server, sheets: sheets, tempDir: tempDir}, nil
}

func startAPI(ctx context.Context, devConfig configgen.Config, container *pgdocker.Container, sheetsSocketPath string) (*app.Server, error) {
	cfg := devConfig
	cfg.Api.Listener = configgen.ListenerConfig{Kind: "tcp"}
	cfg.Api.Listener.SetAddr("localhost:0")
	cfg.Db.Host = container.Host()
	cfg.Db.Port = int32(container.Port())
	cfg.Sheets.Transport = configgen.TransportConfig{Kind: "unix"}
	cfg.Sheets.Transport.SetPath(sheetsSocketPath)

	server, err := app.StartWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	apiBaseURL = "http://" + server.Addr()
	return server, nil
}

func (env *testEnv) Close() error {
	var errs []error

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := env.server.Shutdown(shutdownCtx); err != nil {
		errs = append(errs, fmt.Errorf("shutdown api: %w", err))
	}
	shutdownCancel()
	if err := stopChild(context.Background(), env.sheets); err != nil {
		errs = append(errs, fmt.Errorf("stop sheets: %w", err))
	}
	if err := env.postgres.Close(context.Background()); err != nil {
		errs = append(errs, fmt.Errorf("close postgres: %w", err))
	}
	if err := os.RemoveAll(env.tempDir); err != nil {
		errs = append(errs, fmt.Errorf("remove temp dir: %w", err))
	}

	if len(errs) == 0 {
		return nil
	}
	return errors.Join(errs...)
}

func postgresConfig(db configgen.DBConfig) pgdocker.Config {
	return pgdocker.Config{
		Database: db.Name,
		User:     db.User,
		Password: db.Password,
		SSLMode:  string(db.Sslmode),
	}
}

func TestHealthz(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiBaseURL + "/healthz")
	assert.NilError(t, err, "GET /healthz")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusNoContent, "GET /healthz status")
	assertTraceHeaders(t, resp.Header)
	body, err := io.ReadAll(resp.Body)
	assert.NilError(t, err, "read GET /healthz body")
	assert.Equal(t, string(body), "", "GET /healthz body")
}

func TestHealthzTraceSpan(t *testing.T) {
	t.Parallel()

	exporter := tracetest.NewInMemoryExporter()
	res := resource.NewSchemaless(
		attribute.String("service.name", "recurring-api"),
		attribute.String("deployment.environment", "local"),
	)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithResource(res))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		assert.NilError(t, provider.Shutdown(ctx))
	})

	handler, err := httpapi.NewEcho(nil, httpapi.WithTracerProvider(provider))
	assert.NilError(t, err, "create echo")

	req, err := http.NewRequest(http.MethodGet, "/healthz", http.NoBody)
	assert.NilError(t, err, "create GET /healthz request")
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	req.Header.Set("x-request-id", "request-from-client")
	resp := httptestResponse(t, handler, req)

	assert.Equal(t, resp.StatusCode, http.StatusNoContent, "GET /healthz status")
	assert.Equal(t, resp.Header.Get("x-request-id"), "request-from-client", "response x-request-id")
	assertTraceHeaders(t, resp.Header)

	spans := exporter.GetSpans()
	assert.Equal(t, len(spans), 1, "span count")
	span := spans[0]
	assert.Equal(t, span.Name, "GET /healthz", "span name")
	assert.Equal(t, span.SpanKind, trace.SpanKindServer, "span kind")
	assert.Equal(t, span.SpanContext.TraceID().String(), resp.Header.Get("x-trace-id"), "trace header")
	assert.Equal(t, span.SpanContext.SpanID().String(), resp.Header.Get("x-span-id"), "span header")
	assert.Equal(t, span.Parent.TraceID().String(), "4bf92f3577b34da6a3ce929d0e0e4736", "parent trace id")
	assertResourceAttribute(t, span, "service.name", "recurring-api")
	assertResourceAttribute(t, span, "deployment.environment", "local")
	assertSpanAttribute(t, span, "request_id", "request-from-client")
	assertSpanAttribute(t, span, "http.request.method", http.MethodGet)
	assertSpanAttribute(t, span, "http.route", "/healthz")
	assertSpanAttribute(t, span, "http.response.status_code", int64(http.StatusNoContent))
	assertNoSpanAttribute(t, span, "duration")
}

func TestHealthzGeneratedRequestID(t *testing.T) {
	t.Parallel()

	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		assert.NilError(t, provider.Shutdown(ctx))
	})

	handler, err := httpapi.NewEcho(nil, httpapi.WithTracerProvider(provider))
	assert.NilError(t, err, "create echo")

	req, err := http.NewRequest(http.MethodGet, "/healthz", http.NoBody)
	assert.NilError(t, err, "create GET /healthz request")
	resp := httptestResponse(t, handler, req)

	assert.Equal(t, resp.StatusCode, http.StatusNoContent, "GET /healthz status")
	assertTraceHeaders(t, resp.Header)

	spans := exporter.GetSpans()
	assert.Equal(t, len(spans), 1, "span count")
	assertSpanAttribute(t, spans[0], "request_id", resp.Header.Get("x-request-id"))
}

func TestOpenAPIValidation(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPost, apiBaseURL+"/v1/signup", strings.NewReader(`{}`))
	assert.NilError(t, err, "create POST /v1/signup request")
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/signup")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusBadRequest, "POST /v1/signup status")
}

func TestSignup(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	payload := randomSignupPayload(t)

	first := postSignup(t, client, payload)
	assertGeneratedSessionID(t, first.SessionID)

	updateID := randomHex(t, 8)
	payload.Email = fmt.Sprintf("updated-%s@example.com", updateID)
	payload.Name = stringPtr("Updated User " + updateID)
	payload.PictureURL = stringPtr("https://example.com/updated-avatar-" + updateID + ".png")

	second := postSignup(t, client, payload)
	assertGeneratedSessionID(t, second.SessionID)
	assert.Assert(t, first.SessionID != second.SessionID, "repeat signup returned same session_id %q", second.SessionID)
}

func TestSignupWithoutOptionalProfile(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	payload := randomSignupPayload(t)
	payload.Name = nil
	payload.PictureURL = nil

	body := postSignup(t, client, payload)
	assertGeneratedSessionID(t, body.SessionID)
}

func postSignup(t *testing.T, client http.Client, payload signupPayload) signupSessionResponse {
	t.Helper()

	encoded, err := json.Marshal(payload)
	assert.NilError(t, err, "marshal POST /v1/signup request")

	req, err := http.NewRequest(http.MethodPost, apiBaseURL+"/v1/signup", bytes.NewReader(encoded))
	assert.NilError(t, err, "create POST /v1/signup request")
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/signup")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusOK, "POST /v1/signup status")

	var body signupSessionResponse
	err = json.NewDecoder(resp.Body).Decode(&body)
	assert.NilError(t, err, "decode POST /v1/signup response")
	return body
}

func randomSignupPayload(t *testing.T) signupPayload {
	t.Helper()

	id := randomHex(t, 12)
	return signupPayload{
		GoogleSub:  "google-sub-" + id,
		Email:      "user-" + id + "@example.com",
		Name:       stringPtr("Example User " + id),
		PictureURL: stringPtr("https://example.com/avatar-" + id + ".png"),
	}
}

func randomHex(t *testing.T, n int) string {
	t.Helper()

	bytes := make([]byte, n)
	_, err := rand.Read(bytes)
	assert.NilError(t, err, "read random bytes")
	return hex.EncodeToString(bytes)
}

func stringPtr(value string) *string {
	return &value
}

func assertGeneratedSessionID(t *testing.T, sessionID string) {
	t.Helper()

	assert.Assert(t, sessionIDPattern.MatchString(sessionID), "session_id = %q, want generated session id", sessionID)
}

func httptestResponse(t *testing.T, handler http.Handler, req *http.Request) *http.Response {
	t.Helper()

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder.Result()
}

func assertTraceHeaders(t *testing.T, header http.Header) {
	t.Helper()

	traceID := header.Get("x-trace-id")
	spanID := header.Get("x-span-id")
	requestID := header.Get("x-request-id")
	assert.Assert(t, traceID != "", "x-trace-id is empty")
	assert.Assert(t, spanID != "", "x-span-id is empty")
	assert.Assert(t, requestID != "", "x-request-id is empty")
	assert.Assert(t, traceID != "00000000000000000000000000000000", "x-trace-id is zero")
	assert.Assert(t, spanID != "0000000000000000", "x-span-id is zero")
}

func assertSpanAttribute(t *testing.T, span tracetest.SpanStub, key string, expected any) {
	t.Helper()

	for _, attr := range span.Attributes {
		if string(attr.Key) == key {
			assert.Equal(t, fmt.Sprint(attr.Value.AsInterface()), fmt.Sprint(expected), key)
			return
		}
	}
	t.Fatalf("span attribute %q not found", key)
}

func assertNoSpanAttribute(t *testing.T, span tracetest.SpanStub, key string) {
	t.Helper()

	for _, attr := range span.Attributes {
		assert.Assert(t, string(attr.Key) != key, "span attribute %q should not be present", key)
	}
}

func assertResourceAttribute(t *testing.T, span tracetest.SpanStub, key string, expected string) {
	t.Helper()

	for _, attr := range span.Resource.Attributes() {
		if string(attr.Key) == key {
			assert.Equal(t, attr.Value.AsString(), expected, key)
			return
		}
	}
	t.Fatalf("resource attribute %q not found", key)
}
