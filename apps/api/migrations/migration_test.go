package migrations_test

import (
	"context"
	"database/sql"
	"fmt"
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
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}

	conn, err := ctr.ConnectionString(ctx, "sslmode="+devConfig.DB.SSLMode, "application_name=recurring_migration_test")
	if err != nil {
		t.Fatalf("postgres connection string: %v", err)
	}

	db, err := sql.Open("pgx", conn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.UpToContext(ctx, db, ".", 1); err != nil {
		t.Fatalf("goose up-to 00001: %v", err)
	}

	version, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		t.Fatalf("get goose version: %v", err)
	}
	if version != 1 {
		t.Fatalf("goose version = %d, want 1", version)
	}

	assertGooseAppliedVersion(t, ctx, db)
	assertPgcrypto(t, ctx, db)
	assertExpenseColumns(t, ctx, db)
	assertExpenseConstraints(t, ctx, db)
	assertExpenseInsertBehavior(t, ctx, db)
}

func mustLoadDevConfig(t *testing.T) config.Config {
	t.Helper()

	cfg, err := config.Load(filepath.Join("..", "config", "dev.yaml"))
	if err != nil {
		t.Fatalf("load dev config: %v", err)
	}
	return cfg
}

func assertGooseAppliedVersion(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	var applied bool
	if err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.goose_db_version
			WHERE version_id = 1 AND is_applied
		)
	`).Scan(&applied); err != nil {
		t.Fatalf("query goose version row: %v", err)
	}
	if !applied {
		t.Fatal("goose version 00001 is not recorded as applied")
	}
}

func assertPgcrypto(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	var installed bool
	if err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_extension
			WHERE extname = 'pgcrypto'
		)
	`).Scan(&installed); err != nil {
		t.Fatalf("query pgcrypto extension: %v", err)
	}
	if !installed {
		t.Fatal("pgcrypto extension is not installed")
	}
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
	if err != nil {
		t.Fatalf("query expense columns: %v", err)
	}
	defer rows.Close()

	got := map[string]columnInfo{}
	var order []string
	for rows.Next() {
		var name string
		var col columnInfo
		if err := rows.Scan(&name, &col.dataType, &col.udtName, &col.nullable, &col.maxLength, &col.defaultValue); err != nil {
			t.Fatalf("scan expense column: %v", err)
		}
		got[name] = col
		order = append(order, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate expense columns: %v", err)
	}

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
	if strings.Join(order, ",") != strings.Join(wantOrder, ",") {
		t.Fatalf("expense columns = %v, want %v", order, wantOrder)
	}

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
	if !ok {
		t.Fatalf("missing column %q", name)
	}
	if col.dataType != dataType || col.udtName != udtName || col.nullable != nullable {
		t.Fatalf("column %s = (%s, %s, %s), want (%s, %s, %s)", name, col.dataType, col.udtName, col.nullable, dataType, udtName, nullable)
	}
	if maxLength == 0 && col.maxLength.Valid {
		t.Fatalf("column %s max length = %d, want null", name, col.maxLength.Int64)
	}
	if maxLength > 0 && (!col.maxLength.Valid || col.maxLength.Int64 != maxLength) {
		t.Fatalf("column %s max length = %v, want %d", name, col.maxLength, maxLength)
	}
	if len(defaultParts) == 0 && col.defaultValue.Valid {
		t.Fatalf("column %s default = %q, want null", name, col.defaultValue.String)
	}
	for _, part := range defaultParts {
		if !col.defaultValue.Valid || !strings.Contains(col.defaultValue.String, part) {
			t.Fatalf("column %s default = %q, want substring %q", name, col.defaultValue.String, part)
		}
	}
}

func assertExpenseConstraints(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT conname, pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'public.expenses'::regclass
	`)
	if err != nil {
		t.Fatalf("query expense constraints: %v", err)
	}
	defer rows.Close()

	got := map[string]string{}
	for rows.Next() {
		var name string
		var definition string
		if err := rows.Scan(&name, &definition); err != nil {
			t.Fatalf("scan expense constraint: %v", err)
		}
		got[name] = definition
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate expense constraints: %v", err)
	}

	want := map[string][]string{
		"expenses_pkey":                      {"PRIMARY KEY", "id"},
		"expenses_id_format":                 {"CHECK", "exp_[0-9a-f]{32}"},
		"expenses_name_non_empty":            {"CHECK", "length(name) > 0"},
		"expenses_amount_minor_non_negative": {"CHECK", "amount_minor >= 0"},
		"expenses_currency_uppercase_iso":    {"CHECK", "^[A-Z]{3}$"},
		"expenses_recurring_positive":        {"CHECK", "recurring > '00:00:00'::interval"},
		"expenses_category_non_empty":        {"CHECK", "length(category) > 0"},
		"expenses_comment_non_empty":         {"CHECK", "length(comment) > 0"},
	}
	for name, parts := range want {
		definition, ok := got[name]
		if !ok {
			t.Fatalf("missing constraint %q; got %v", name, got)
		}
		for _, part := range parts {
			if !strings.Contains(definition, part) {
				t.Fatalf("constraint %s = %q, want substring %q", name, definition, part)
			}
		}
	}
}

func assertExpenseInsertBehavior(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	var id string
	if err := db.QueryRowContext(ctx, `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at)
		VALUES ('Rent', 125000, 'USD', now())
		RETURNING id
	`).Scan(&id); err != nil {
		t.Fatalf("insert valid expense: %v", err)
	}
	if !regexp.MustCompile(`^exp_[0-9a-f]{32}$`).MatchString(id) {
		t.Fatalf("generated id = %q, want exp_ plus 32 lowercase hex chars", id)
	}

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

	if _, err := db.ExecContext(ctx, query); err == nil {
		t.Fatalf("%s insert succeeded, want constraint error", name)
	} else if !strings.Contains(fmt.Sprint(err), "SQLSTATE 23514") {
		t.Fatalf("%s insert error = %v, want check violation", name, err)
	}
}
