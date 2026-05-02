package apitest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/recurring/api/internal/app"
	"github.com/recurring/api/internal/config"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

var apiBaseURL string

type testEnv struct {
	postgres *postgres.PostgresContainer
	server   *app.Server
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

func startTestEnv(ctx context.Context, devConfig config.Config) (*testEnv, error) {
	container, err := postgres.Run(ctx,
		"postgres:18-alpine",
		postgres.WithDatabase(devConfig.DB.Name),
		postgres.WithUsername(devConfig.DB.User),
		postgres.WithPassword(devConfig.DB.Password),
		postgres.BasicWaitStrategies(),
		postgres.WithSQLDriver("pgx"),
	)
	if err != nil {
		return nil, fmt.Errorf("start postgres: %w", err)
	}

	server, err := startAPI(ctx, devConfig, container)
	if err != nil {
		_ = container.Terminate(context.Background())
		return nil, fmt.Errorf("start api: %w", err)
	}
	return &testEnv{postgres: container, server: server}, nil
}

func startAPI(ctx context.Context, devConfig config.Config, container *postgres.PostgresContainer) (*app.Server, error) {
	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("postgres host: %w", err)
	}
	port, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		return nil, fmt.Errorf("postgres mapped port: %w", err)
	}

	cfg := devConfig
	cfg.API.Listener = config.ListenerConfig{Kind: "tcp", Addr: "localhost:0"}
	cfg.DB.Host = host
	cfg.DB.Port = int(port.Num())
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

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
	if err := env.postgres.Terminate(context.Background()); err != nil {
		errs = append(errs, fmt.Errorf("terminate postgres: %w", err))
	}

	if len(errs) == 0 {
		return nil
	}
	return errors.Join(errs...)
}

func TestHealthz(t *testing.T) {
	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(apiBaseURL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read GET /healthz body: %v", err)
	}
	if string(body) != "" {
		t.Fatalf("GET /healthz body = %q, want empty", string(body))
	}
}

func TestOpenAPIValidation(t *testing.T) {
	client := http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPost, apiBaseURL+"/v1/signup", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("create POST /v1/signup request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/signup: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST /v1/signup status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}
