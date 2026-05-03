package migrations_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/recurring/api/internal/config"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"gotest.tools/v3/assert"
)

func TestMigration00001(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	devConfig := mustLoadDevConfig(t)
	ctr, err := postgres.Run(ctx,
		"postgres:18-alpine",
		postgres.WithDatabase(devConfig.DB.Name),
		postgres.WithUsername(devConfig.DB.User),
		postgres.WithPassword(devConfig.DB.Password),
		postgres.BasicWaitStrategies(),
		postgres.WithSQLDriver("pgx"),
	)
	testcontainers.CleanupContainer(t, ctr)
	assert.NilError(t, err, "start postgres")

	conn, err := ctr.ConnectionString(ctx, "sslmode="+devConfig.DB.SSLMode, "application_name=recurring_migration_test")
	assert.NilError(t, err, "postgres connection string")

	db, err := sql.Open("pgx", conn)
	assert.NilError(t, err, "open postgres")
	defer db.Close()

	err = goose.SetDialect("postgres")
	assert.NilError(t, err, "set goose dialect")
	err = goose.UpToContext(ctx, db, ".", 1)
	assert.NilError(t, err, "goose up-to 00001")

	version, err := goose.GetDBVersionContext(ctx, db)
	assert.NilError(t, err, "get goose version")
	assert.Equal(t, version, int64(1), "goose version")

	assertGooseAppliedVersion(t, ctx, db)
	assertPgcrypto(t, ctx, db)
	assertExpenseColumns(t, ctx, db)
	assertExpenseConstraints(t, ctx, db)
	assertExpenseInsertBehavior(t, ctx, db)
}

func mustLoadDevConfig(t *testing.T) config.Config {
	t.Helper()

	cfg, err := config.Load(filepath.Join("..", "config", "dev.yaml"))
	assert.NilError(t, err, "load dev config")
	return cfg
}

func assertGooseAppliedVersion(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	var applied bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.goose_db_version
			WHERE version_id = 1 AND is_applied
		)
	`).Scan(&applied)
	assert.NilError(t, err, "query goose version row")
	assert.Assert(t, applied, "goose version 00001 is not recorded as applied")
}

func assertPgcrypto(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	var installed bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_extension
			WHERE extname = 'pgcrypto'
		)
	`).Scan(&installed)
	assert.NilError(t, err, "query pgcrypto extension")
	assert.Assert(t, installed, "pgcrypto extension is not installed")
}

type columnInfo struct {
	dataType     string
	udtName      string
	nullable     string
	maxLength    sql.NullInt64
	defaultValue sql.NullString
}

func assertExpenseColumns(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'expenses'
		ORDER BY ordinal_position
	`)
	assert.NilError(t, err, "query expense columns")
	defer rows.Close()

	got := map[string]columnInfo{}
	var order []string
	for rows.Next() {
		var name string
		var col columnInfo
		assert.NilError(t, rows.Scan(&name, &col.dataType, &col.udtName, &col.nullable, &col.maxLength, &col.defaultValue), "scan expense column")
		got[name] = col
		order = append(order, name)
	}
	assert.NilError(t, rows.Err(), "iterate expense columns")

	wantOrder := []string{
		"id",
		"name",
		"amount_minor",
		"currency",
		"recurring",
		"started_at",
		"category",
		"comment",
		"cancel_url",
		"canceled_at",
		"created_at",
		"updated_at",
	}
	assert.DeepEqual(t, order, wantOrder)

	assertColumn(t, got, "id", "text", "text", "NO", 0, []string{"exp_", "gen_random_bytes", "encode"})
	assertColumn(t, got, "name", "text", "text", "NO", 0, nil)
	assertColumn(t, got, "amount_minor", "bigint", "int8", "NO", 0, nil)
	assertColumn(t, got, "currency", "character", "bpchar", "NO", 3, nil)
	assertColumn(t, got, "recurring", "interval", "interval", "YES", 0, nil)
	assertColumn(t, got, "started_at", "timestamp with time zone", "timestamptz", "NO", 0, nil)
	assertColumn(t, got, "category", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "comment", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "cancel_url", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "canceled_at", "timestamp with time zone", "timestamptz", "YES", 0, nil)
	assertColumn(t, got, "created_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{"now()"})
	assertColumn(t, got, "updated_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{"now()"})
}

func assertColumn(t *testing.T, got map[string]columnInfo, name string, dataType string, udtName string, nullable string, maxLength int64, defaultParts []string) {
	t.Helper()

	col, ok := got[name]
	assert.Assert(t, ok, "missing column %q", name)
	assert.Equal(t, col.dataType, dataType, "column %s data_type", name)
	assert.Equal(t, col.udtName, udtName, "column %s udt_name", name)
	assert.Equal(t, col.nullable, nullable, "column %s is_nullable", name)
	if maxLength == 0 && col.maxLength.Valid {
		assert.Assert(t, !col.maxLength.Valid, "column %s max length = %d, want null", name, col.maxLength.Int64)
	}
	if maxLength > 0 && (!col.maxLength.Valid || col.maxLength.Int64 != maxLength) {
		assert.Assert(t, col.maxLength.Valid && col.maxLength.Int64 == maxLength, "column %s max length = %v, want %d", name, col.maxLength, maxLength)
	}
	if len(defaultParts) == 0 && col.defaultValue.Valid {
		assert.Assert(t, !col.defaultValue.Valid, "column %s default = %q, want null", name, col.defaultValue.String)
	}
	for _, part := range defaultParts {
		assert.Assert(t, col.defaultValue.Valid, "column %s default = null, want substring %q", name, part)
		assert.Assert(t, strings.Contains(col.defaultValue.String, part), "column %s default = %q, want substring %q", name, col.defaultValue.String, part)
	}
}

func assertExpenseConstraints(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'public.expenses'::regclass
	`)
	assert.NilError(t, err, "query expense constraints")
	defer rows.Close()

	var got []string
	for rows.Next() {
		var definition string
		assert.NilError(t, rows.Scan(&definition), "scan expense constraint")
		got = append(got, definition)
	}
	assert.NilError(t, rows.Err(), "iterate expense constraints")

	want := [][]string{
		{"PRIMARY KEY", "id"},
		{"CHECK", "exp_[0-9a-f]{32}"},
		{"CHECK", "length(name) > 0"},
		{"CHECK", "amount_minor >= 0"},
		{"CHECK", "^[A-Z]{3}$"},
		{"CHECK", "recurring > '00:00:00'::interval"},
		{"CHECK", "length(category) > 0"},
		{"CHECK", "length(comment) > 0"},
	}
	for _, parts := range want {
		assertConstraintDefinition(t, got, parts)
	}
}

func assertConstraintDefinition(t *testing.T, got []string, parts []string) {
	t.Helper()

	for _, definition := range got {
		matches := true
		for _, part := range parts {
			matches = matches && strings.Contains(definition, part)
		}
		if matches {
			return
		}
	}
	assert.Assert(t, false, "missing constraint containing %v; got %v", parts, got)
}

func assertExpenseInsertBehavior(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	var id string
	err := db.QueryRowContext(ctx, `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at)
		VALUES ('Rent', 125000, 'USD', now())
		RETURNING id
	`).Scan(&id)
	assert.NilError(t, err, "insert valid expense")
	assert.Assert(t, regexp.MustCompile(`^exp_[0-9a-f]{32}$`).MatchString(id), "generated id = %q, want exp_ plus 32 lowercase hex chars", id)

	assertInsertRejected(t, ctx, db, "negative amount_minor", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at)
		VALUES ('Rent', -1, 'USD', now())
	`)
	assertInsertRejected(t, ctx, db, "lowercase currency", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at)
		VALUES ('Rent', 1, 'usd', now())
	`)
	assertInsertRejected(t, ctx, db, "empty name", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at)
		VALUES ('', 1, 'USD', now())
	`)
	assertInsertRejected(t, ctx, db, "empty category", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, category)
		VALUES ('Rent', 1, 'USD', now(), '')
	`)
	assertInsertRejected(t, ctx, db, "empty comment", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, comment)
		VALUES ('Rent', 1, 'USD', now(), '')
	`)
}

func assertInsertRejected(t *testing.T, ctx context.Context, db *sql.DB, name string, query string) {
	t.Helper()

	_, err := db.ExecContext(ctx, query)
	assert.Assert(t, err != nil, "%s insert succeeded, want constraint error", name)
	assert.Assert(t, strings.Contains(err.Error(), "SQLSTATE 23514"), "%s insert error = %v, want check violation", name, err)
}
