package apitest

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/recurring/api/internal/app"
	"github.com/recurring/api/internal/config"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/serviceclient"
	"github.com/recurring/api/pkg/pgdocker"
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

type childProcess struct {
	cmd  *exec.Cmd
	done chan error
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

	sheetsSocketPath := filepath.Join(tempDir, "sheets.sock")
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

func startSheets(ctx context.Context, socketPath string) (*childProcess, error) {
	cmd := exec.CommandContext(ctx, "bun", "src/cmd.ts")
	cmd.Dir = filepath.Join("..", "..", "..", "sheets")
	cmd.Env = append(os.Environ(),
		"NODE_ENV=test",
		"RECURRING_SHEETS_LISTENER_KIND=unix",
		"RECURRING_SHEETS_SOCKET_PATH="+socketPath,
	)
	if err := pipeCommand(cmd, "sheets"); err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start sheets: %w", err)
	}
	child := &childProcess{cmd: cmd, done: make(chan error, 1)}
	go func() {
		child.done <- cmd.Wait()
	}()
	return child, nil
}

func waitForSheets(ctx context.Context, socketPath string, sheets *childProcess) error {
	httpClient := serviceclient.NewHTTPClient(serviceclient.Config{
		UnixSocketPath: socketPath,
		Timeout:        time.Second,
		MaxAttempts:    1,
	})
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case err := <-sheets.done:
			return fmt.Errorf("sheets exited before readiness: %w", err)
		case <-deadline.C:
			return errors.New("wait for sheets /healthz: timeout")
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := getHealthz(ctx, "http://recurring-sheets/healthz", httpClient); err == nil {
				return nil
			}
		}
	}
}

func getHealthz(ctx context.Context, url string, client *http.Client) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %s", resp.Status)
	}
	return nil
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

func pipeCommand(cmd *exec.Cmd, prefix string) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("open stderr pipe: %w", err)
	}
	go pipeLines(os.Stdout, prefix, stdout)
	go pipeLines(os.Stderr, prefix, stderr)
	return nil
}

func pipeLines(out io.Writer, prefix string, input io.Reader) {
	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		_, _ = fmt.Fprintf(out, "[%s] %s\n", prefix, scanner.Text())
	}
}

func stopChild(ctx context.Context, child *childProcess) error {
	if child == nil || child.cmd.Process == nil {
		return nil
	}
	select {
	case err := <-child.done:
		return err
	default:
	}
	if err := child.cmd.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	select {
	case <-child.done:
		return nil
	case <-time.After(5 * time.Second):
		if err := child.cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
		select {
		case <-child.done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	case <-ctx.Done():
		return ctx.Err()
	}
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

	assert.Equal(t, resp.StatusCode, http.StatusOK, "GET /healthz status")
	body, err := io.ReadAll(resp.Body)
	assert.NilError(t, err, "read GET /healthz body")
	assert.Equal(t, string(body), "", "GET /healthz body")
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
