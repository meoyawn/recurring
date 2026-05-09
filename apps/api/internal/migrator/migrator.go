package migrator

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/recurring/api/migrations"
)

const startupTimeout = 30 * time.Second

func Up(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, startupTimeout)
	defer cancel()

	db := stdlib.OpenDBFromPool(pool)
	defer func() {
		_ = db.Close()
	}()

	goose.SetBaseFS(migrations.SQLs)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	return nil
}
