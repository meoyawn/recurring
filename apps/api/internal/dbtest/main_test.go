package dbtest

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/recurring/api/internal/config"
	"github.com/recurring/api/internal/db"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/migrator"
	"github.com/recurring/api/pkg/pgdocker"
)

const maxPostgresPort = math.MaxInt32

var testPool *pgxpool.Pool

type testEnv struct {
	postgres *pgdocker.Container
	pool     *pgxpool.Pool
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
		fmt.Fprintf(os.Stderr, "start db test environment: %v\n", err)
		return 1
	}
	testPool = env.pool

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

	cfg := devConfig.Db
	cfg.Host = container.Host()
	port, err := postgresPort(container.Port())
	if err != nil {
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, err
	}
	cfg.Port = port

	pool, err := db.Open(ctx, cfg)
	if err != nil {
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("open postgres pool: %w", err)
	}
	if err := migrator.Up(ctx, pool); err != nil {
		pool.Close()
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("migrate postgres: %w", err)
	}

	return &testEnv{postgres: container, pool: pool}, nil
}

func postgresConfig(db configgen.DBConfig) pgdocker.Config {
	return pgdocker.Config{
		Database: db.Name,
		User:     db.User,
		Password: db.Password,
		SSLMode:  string(db.Sslmode),
	}
}

func postgresPort(port int) (int32, error) {
	if port < 0 || port > maxPostgresPort {
		return 0, fmt.Errorf("postgres port %d cannot fit in int32", port)
	}
	return int32(port), nil
}

func (env *testEnv) Close() error {
	var errs []error
	if env.pool != nil {
		env.pool.Close()
	}
	if env.postgres != nil {
		if err := env.postgres.Close(context.Background()); err != nil {
			errs = append(errs, fmt.Errorf("close postgres: %w", err))
		}
	}
	return errors.Join(errs...)
}
