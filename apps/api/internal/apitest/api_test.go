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
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/recurring/api/internal/app"
	"github.com/recurring/api/internal/config"
	"github.com/recurring/api/internal/dbtest"
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

var (
	apiBaseURL                  string
	apiPostgresConnectionString string
	sessionIDPattern            = regexp.MustCompile(`^sess_[0-9a-f]{32}$`)
)

const (
	headerTraceID       = "X-Trace-Id"
	headerSpanID        = "X-Span-Id"
	headerRequestID     = "X-Request-Id"
	headerTraceparent   = "Traceparent"
	otelpgxTracerName   = "github.com/exaring/otelpgx"
	maxPostgresPort     = math.MaxInt32
	providerStopTimeout = 5 * time.Second
	validationIssueBody = "body"
	validationRequired  = "required"
)

type signupPayload struct {
	GoogleSub  string  `json:"google_sub"`
	Email      string  `json:"email"`
	Name       *string `json:"name,omitempty"`
	PictureURL *string `json:"picture_url,omitempty"`
}

type signupSessionResponse struct {
	SessionID string `json:"session_id"`
}

type createProjectPayload struct {
	Name string `json:"name"`
}

type moneyPayload struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type createExpensePayload struct {
	Name       string       `json:"name"`
	Money      moneyPayload `json:"money"`
	Recurring  *string      `json:"recurring,omitempty"`
	StartedAt  int64        `json:"started_at"`
	Category   *string      `json:"category,omitempty"`
	Comment    *string      `json:"comment,omitempty"`
	CancelURL  *string      `json:"cancel_url,omitempty"`
	CanceledAt *int64       `json:"canceled_at,omitempty"`
}

type projectResponse struct {
	Name       string `json:"name"`
	ArchivedAt *int64 `json:"archived_at,omitempty"`
}

type expenseResponse struct {
	Name       string       `json:"name"`
	Money      moneyPayload `json:"money"`
	Recurring  *string      `json:"recurring,omitempty"`
	StartedAt  int64        `json:"started_at"`
	Category   *string      `json:"category,omitempty"`
	Comment    *string      `json:"comment,omitempty"`
	CancelURL  *string      `json:"cancel_url,omitempty"`
	CanceledAt *int64       `json:"canceled_at,omitempty"`
}

type validationErrorResponse struct {
	Message string                    `json:"message"`
	Errors  []validationIssueResponse `json:"errors"`
}

type validationIssueResponse struct {
	In      string   `json:"in"`
	Field   string   `json:"field,omitempty"`
	Path    []string `json:"path,omitempty"`
	Code    string   `json:"code"`
	Message string   `json:"message"`
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

	devConfig, err := config.Load(filepath.Join("..", "..", "config", "test.yaml"))
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
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("create temp dir: %w", err)
	}

	sheetsSocketPath, err := randomSocketPath(tempDir)
	if err != nil {
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, err
	}
	sheets, err := startSheets(ctx, sheetsSocketPath, devConfig.Telemetry)
	if err != nil {
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, err
	}
	if err := waitForSheets(ctx, sheetsSocketPath, sheets); err != nil {
		_ = stopChild(context.WithoutCancel(ctx), sheets)
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, err
	}

	server, err := startAPI(ctx, devConfig, container, sheetsSocketPath)
	if err != nil {
		_ = stopChild(context.WithoutCancel(ctx), sheets)
		_ = os.RemoveAll(tempDir)
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("start api: %w", err)
	}
	return &testEnv{postgres: container, server: server, sheets: sheets, tempDir: tempDir}, nil
}

func startAPI(
	ctx context.Context,
	devConfig configgen.Config,
	container *pgdocker.Container,
	sheetsSocketPath string,
) (*app.Server, error) {
	cfg := devConfig
	cfg.Api.Listener = configgen.ListenerConfig{Kind: configgen.TCP}
	cfg.Api.Listener.SetAddr("localhost:0")
	cfg.Db.Host = container.Host()
	port, err := postgresPort(container.Port())
	if err != nil {
		return nil, err
	}
	cfg.Db.Port = port
	cfg.Sheets.Transport = configgen.TransportConfig{Kind: configgen.UNIX}
	cfg.Sheets.Transport.SetPath(sheetsSocketPath)

	server, err := app.StartWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	apiBaseURL = "http://" + server.Addr()
	apiPostgresConnectionString = container.ConnectionString("recurring_api_test")
	return server, nil
}

func postgresPort(port int) (int32, error) {
	if port < 0 || port > maxPostgresPort {
		return 0, fmt.Errorf("postgres port %d cannot fit in int32", port)
	}
	return int32(port), nil
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
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, apiBaseURL+"/healthz", http.NoBody)
	assert.NilError(t, err, "create GET /healthz request")
	resp, err := client.Do(req)
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
	)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter), sdktrace.WithResource(res))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(t.Context()), providerStopTimeout)
		defer cancel()
		assert.NilError(t, provider.Shutdown(ctx))
	})

	handler := newTraceHandler(t, provider)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "/healthz", http.NoBody)
	assert.NilError(t, err, "create GET /healthz request")
	req.Header.Set(headerTraceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	req.Header.Set(headerRequestID, "request-from-client")
	resp := httptestResponse(t, handler, req)
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusNoContent, "GET /healthz status")
	assert.Equal(t, resp.Header.Get(headerRequestID), "request-from-client", "response x-request-id")
	assertTraceHeaders(t, resp.Header)

	spans := exporter.GetSpans()
	assert.Equal(t, len(spans), 1, "span count")
	span := spans[0]
	assert.Equal(t, span.Name, "GET /healthz", "span name")
	assert.Equal(t, span.SpanKind, trace.SpanKindServer, "span kind")
	assert.Equal(t, span.SpanContext.TraceID().String(), resp.Header.Get(headerTraceID), "trace header")
	assert.Equal(t, span.SpanContext.SpanID().String(), resp.Header.Get(headerSpanID), "span header")
	assert.Equal(t, span.Parent.TraceID().String(), "4bf92f3577b34da6a3ce929d0e0e4736", "parent trace id")
	assertResourceAttribute(t, span, "service.name", "recurring-api")
	assertSpanAttribute(t, span, "http.request.header.x-request-id", []string{"request-from-client"})
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
		ctx, cancel := context.WithTimeout(context.WithoutCancel(t.Context()), providerStopTimeout)
		defer cancel()
		assert.NilError(t, provider.Shutdown(ctx))
	})

	handler := newTraceHandler(t, provider)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "/healthz", http.NoBody)
	assert.NilError(t, err, "create GET /healthz request")
	resp := httptestResponse(t, handler, req)
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusNoContent, "GET /healthz status")
	assertTraceHeaders(t, resp.Header)

	spans := exporter.GetSpans()
	assert.Equal(t, len(spans), 1, "span count")
	assertSpanAttribute(t, spans[0], "http.request.header.x-request-id", []string{resp.Header.Get(headerRequestID)})
}

func TestOpenAPIValidation(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/signup",
		strings.NewReader(`{}`),
	)
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
	payload.Name = new("Updated User " + updateID)
	payload.PictureURL = new("https://example.com/updated-avatar-" + updateID + ".png")

	second := postSignup(t, client, payload)
	assertGeneratedSessionID(t, second.SessionID)
	assert.Assert(t, first.SessionID != second.SessionID, "repeat signup returned same session_id %q", second.SessionID)
}

func TestSessionSecurityRejectsMissingBearer(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, apiBaseURL+"/v1/session/projects", http.NoBody)
	assert.NilError(t, err, "create GET /v1/session/projects request")

	resp, err := client.Do(req)
	assert.NilError(t, err, "GET /v1/session/projects")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusUnauthorized, "GET /v1/session/projects status")
}

func TestSessionSecurityRejectsUnknownSession(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, apiBaseURL+"/v1/session/projects", http.NoBody)
	assert.NilError(t, err, "create GET /v1/session/projects request")
	req.Header.Set("Authorization", "Bearer sess_00000000000000000000000000000000")

	resp, err := client.Do(req)
	assert.NilError(t, err, "GET /v1/session/projects")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusUnauthorized, "GET /v1/session/projects status")
}

func TestSessionSecurityAcceptsSignupSession(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	session := postSignup(t, client, randomSignupPayload(t))
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, apiBaseURL+"/v1/session/projects", http.NoBody)
	assert.NilError(t, err, "create GET /v1/session/projects request")
	req.Header.Set("Authorization", "Bearer "+session.SessionID)

	resp, err := client.Do(req)
	assert.NilError(t, err, "GET /v1/session/projects")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusNotImplemented, "GET /v1/session/projects status")
}

func TestCreateProjectRejectsMissingBearer(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	encoded, err := json.Marshal(createProjectPayload{Name: "Home"})
	assert.NilError(t, err, "marshal POST /v1/session/projects request")

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/session/projects",
		bytes.NewReader(encoded),
	)
	assert.NilError(t, err, "create POST /v1/session/projects request")
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/session/projects")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusUnauthorized, "POST /v1/session/projects status")
}

func TestCreateProject(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	session := postSignup(t, client, randomSignupPayload(t))
	projectName := "Home " + randomHex(t, 8)
	encoded, err := json.Marshal(createProjectPayload{Name: projectName})
	assert.NilError(t, err, "marshal POST /v1/session/projects request")

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/session/projects",
		bytes.NewReader(encoded),
	)
	assert.NilError(t, err, "create POST /v1/session/projects request")
	req.Header.Set("Authorization", "Bearer "+session.SessionID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/session/projects")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusCreated, "POST /v1/session/projects status")

	var body projectResponse
	err = json.NewDecoder(resp.Body).Decode(&body)
	assert.NilError(t, err, "decode POST /v1/session/projects response")
	assert.Equal(t, body.Name, projectName, "POST /v1/session/projects name")
	assert.Assert(t, body.ArchivedAt == nil, "POST /v1/session/projects archived_at = %v, want null", body.ArchivedAt)
}

func TestCreateExpense(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	session := postSignup(t, client, randomSignupPayload(t))
	projectName := "Expense Project " + randomHex(t, 8)
	projectID := postProject(t, client, session.SessionID, projectName)
	recurring := "P1M"
	category := "Housing"
	comment := "Monthly rent"
	cancelURL := "https://example.com/cancel"
	canceledAt := time.Date(2026, time.June, 1, 12, 0, 0, 0, time.UTC).UnixMilli()
	payload := createExpensePayload{
		Name: "Rent " + randomHex(t, 8),
		Money: moneyPayload{
			Amount:   125000,
			Currency: "USD",
		},
		Recurring:  &recurring,
		StartedAt:  time.Date(2026, time.May, 1, 12, 0, 0, 0, time.UTC).UnixMilli(),
		Category:   &category,
		Comment:    &comment,
		CancelURL:  &cancelURL,
		CanceledAt: &canceledAt,
	}
	encoded, err := json.Marshal(payload)
	assert.NilError(t, err, "marshal POST /v1/session/projects/:id/expenses request")

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/session/projects/"+projectID+"/expenses",
		bytes.NewReader(encoded),
	)
	assert.NilError(t, err, "create POST /v1/session/projects/:id/expenses request")
	req.Header.Set("Authorization", "Bearer "+session.SessionID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/session/projects/:id/expenses")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusCreated, "POST /v1/session/projects/:id/expenses status")

	var body expenseResponse
	err = json.NewDecoder(resp.Body).Decode(&body)
	assert.NilError(t, err, "decode POST /v1/session/projects/:id/expenses response")
	assert.DeepEqual(t, body, expenseResponse(payload))
	assertExpenseInserted(t, projectID, payload)
}

func TestCreateExpenseValidationErrors(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	session := postSignup(t, client, randomSignupPayload(t))
	projectName := "Expense Validation Project " + randomHex(t, 8)
	projectID := postProject(t, client, session.SessionID, projectName)

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/session/projects/"+projectID+"/expenses",
		strings.NewReader(`{"money":{"currency":"USD"}}`),
	)
	assert.NilError(t, err, "create invalid POST /v1/session/projects/:id/expenses request")
	req.Header.Set("Authorization", "Bearer "+session.SessionID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST invalid /v1/session/projects/:id/expenses")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusBadRequest, "POST invalid /v1/session/projects/:id/expenses status")

	var body validationErrorResponse
	err = json.NewDecoder(resp.Body).Decode(&body)
	assert.NilError(t, err, "decode POST invalid /v1/session/projects/:id/expenses response")
	assert.Equal(t, body.Message, "Validation failed", "POST invalid /v1/session/projects/:id/expenses message")
	assertValidationIssue(t, body.Errors, validationIssueResponse{
		In:    validationIssueBody,
		Field: "started_at",
		Path:  []string{"started_at"},
		Code:  validationRequired,
	})
	assertValidationIssue(t, body.Errors, validationIssueResponse{
		In:    validationIssueBody,
		Field: "name",
		Path:  []string{"name"},
		Code:  validationRequired,
	})
	assertValidationIssue(t, body.Errors, validationIssueResponse{
		In:    validationIssueBody,
		Field: "money.amount",
		Path:  []string{"money", "amount"},
		Code:  validationRequired,
	})
}

func TestSignupPostgresTrace(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	payload := randomSignupPayload(t)
	encoded, err := json.Marshal(payload)
	assert.NilError(t, err, "marshal POST /v1/signup request")

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/signup",
		bytes.NewReader(encoded),
	)
	assert.NilError(t, err, "create POST /v1/signup request")
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/signup")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusOK, "POST /v1/signup status")
	assertTraceHeaders(t, resp.Header)

	var body signupSessionResponse
	err = json.NewDecoder(resp.Body).Decode(&body)
	assert.NilError(t, err, "decode POST /v1/signup response")
	assertGeneratedSessionID(t, body.SessionID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = waitForJaegerTrace(ctx, resp.Header.Get(headerTraceID), otelpgxTracerName)
	assert.NilError(t, err, "wait for signup PostgreSQL trace")
}

func TestSheetsTracePropagation(t *testing.T) {
	t.Parallel()

	client := http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, apiBaseURL+"/sheets-test", http.NoBody)
	assert.NilError(t, err, "create GET /sheets-test request")

	resp, err := client.Do(req)
	assert.NilError(t, err, "GET /sheets-test")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusNoContent, "GET /sheets-test status")
	assertTraceHeaders(t, resp.Header)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = waitForJaegerTrace(ctx, resp.Header.Get(headerTraceID), "recurring-sheets")
	assert.NilError(t, err, "wait for sheets service trace")
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

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/signup",
		bytes.NewReader(encoded),
	)
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

func postProject(t *testing.T, client http.Client, sessionID string, projectName string) string {
	t.Helper()

	encoded, err := json.Marshal(createProjectPayload{Name: projectName})
	assert.NilError(t, err, "marshal POST /v1/session/projects request")

	req, err := http.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		apiBaseURL+"/v1/session/projects",
		bytes.NewReader(encoded),
	)
	assert.NilError(t, err, "create POST /v1/session/projects request")
	req.Header.Set("Authorization", "Bearer "+sessionID)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	assert.NilError(t, err, "POST /v1/session/projects")
	defer func() {
		_ = resp.Body.Close()
	}()

	assert.Equal(t, resp.StatusCode, http.StatusCreated, "POST /v1/session/projects status")

	projectID, err := dbtest.SelectProjectIDByName(t.Context(), apiPostgresConnectionString, projectName)
	assert.NilError(t, err, "select project id")
	return projectID
}

func assertExpenseInserted(t *testing.T, projectID string, payload createExpensePayload) {
	t.Helper()

	exists, err := dbtest.ExpenseExists(t.Context(), apiPostgresConnectionString, dbtest.InsertedExpense{
		ProjectID:   projectID,
		Name:        payload.Name,
		AmountMinor: payload.Money.Amount,
		Currency:    payload.Money.Currency,
		Recurring:   *payload.Recurring,
		StartedAt:   payload.StartedAt,
		Category:    *payload.Category,
		Comment:     *payload.Comment,
		CancelURL:   *payload.CancelURL,
		CanceledAt:  *payload.CanceledAt,
	})
	assert.NilError(t, err, "select inserted expense")
	assert.Assert(t, exists, "inserted expense was not found")
}

func assertValidationIssue(t *testing.T, issues []validationIssueResponse, expected validationIssueResponse) {
	t.Helper()

	for _, issue := range issues {
		if issue.In != expected.In || issue.Field != expected.Field || issue.Code != expected.Code {
			continue
		}

		assert.DeepEqual(t, issue.Path, expected.Path)
		assert.Assert(t, issue.Message != "", "validation issue %s message is empty", expected.Field)
		return
	}

	t.Fatalf(
		"validation issue not found: in=%q field=%q code=%q body=%+v",
		expected.In,
		expected.Field,
		expected.Code,
		issues,
	)
}

func randomSignupPayload(t *testing.T) signupPayload {
	t.Helper()

	id := randomHex(t, 12)
	return signupPayload{
		GoogleSub:  "google-sub-" + id,
		Email:      "user-" + id + "@example.com",
		Name:       new("Example User " + id),
		PictureURL: new("https://example.com/avatar-" + id + ".png"),
	}
}

func randomHex(t *testing.T, n int) string {
	t.Helper()

	bytes := make([]byte, n)
	_, err := rand.Read(bytes)
	assert.NilError(t, err, "read random bytes")
	return hex.EncodeToString(bytes)
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

func newTraceHandler(t *testing.T, provider trace.TracerProvider) http.Handler {
	t.Helper()

	pool, err := pgxpool.New(t.Context(), apiPostgresConnectionString)
	assert.NilError(t, err, "open trace test database pool")
	t.Cleanup(pool.Close)

	handler, err := httpapi.NewEcho(pool, httpapi.WithTracerProvider(provider))
	assert.NilError(t, err, "create echo")
	return handler
}

func assertTraceHeaders(t *testing.T, header http.Header) {
	t.Helper()

	traceID := header.Get(headerTraceID)
	spanID := header.Get(headerSpanID)
	requestID := header.Get(headerRequestID)
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
