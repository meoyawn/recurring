package migrator

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/recurring/api/migrations"
)

const startupTimeout = 30 * time.Second

func Up(ctx context.Context, connString string) error {
	ctx, cancel := context.WithTimeout(ctx, startupTimeout)
	defer cancel()

	db, err := sql.Open("pgx", connString)
	if err != nil {
		return fmt.Errorf("open migration db: %w", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}
	if err := goose.UpContext(ctx, db, "."); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	return nil
}
