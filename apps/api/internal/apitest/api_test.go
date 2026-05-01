package apitest

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/recurring/api/internal/app"
	"github.com/recurring/api/internal/config"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"gopkg.in/yaml.v3"
)

var apiBaseURL string

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

	container, err := postgres.Run(ctx,
		"postgres:18-alpine",
		postgres.WithDatabase(devConfig.DB.Name),
		postgres.WithUsername(devConfig.DB.User),
		postgres.WithPassword(devConfig.DB.Password),
		postgres.BasicWaitStrategies(),
		postgres.WithSQLDriver("pgx"),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start postgres: %v\n", err)
		return 1
	}

	tempDir, err := os.MkdirTemp("", "recurring-api-test-*")
	if err != nil {
		_ = container.Terminate(context.Background())
		fmt.Fprintf(os.Stderr, "create temp dir: %v\n", err)
		return 1
	}

	server, err := startAPI(ctx, devConfig, container, tempDir)
	if err != nil {
		_ = container.Terminate(context.Background())
		_ = os.RemoveAll(tempDir)
		fmt.Fprintf(os.Stderr, "start api: %v\n", err)
		return 1
	}

	code := m.Run()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := server.Shutdown(shutdownCtx); err != nil {
		fmt.Fprintf(os.Stderr, "shutdown api: %v\n", err)
		code = 1
	}
	shutdownCancel()
	if err := container.Terminate(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "terminate postgres: %v\n", err)
		code = 1
	}
	if err := os.RemoveAll(tempDir); err != nil {
		fmt.Fprintf(os.Stderr, "remove temp dir: %v\n", err)
		code = 1
	}
	return code
}

func startAPI(ctx context.Context, devConfig config.Config, container *postgres.PostgresContainer, tempDir string) (*app.Server, error) {
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

	raw, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("marshal temp config: %w", err)
	}
	configPath := filepath.Join(tempDir, "api.yaml")
	if err := os.WriteFile(configPath, raw, 0600); err != nil {
		return nil, fmt.Errorf("write temp config: %w", err)
	}
	if err := os.Setenv(config.EnvPath, configPath); err != nil {
		return nil, fmt.Errorf("set %s: %w", config.EnvPath, err)
	}

	server, err := app.Start(ctx)
	if err != nil {
		return nil, err
	}
	apiBaseURL = "http://" + server.Addr()
	return server, nil
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
}
