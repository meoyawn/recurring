package migrations_test

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/recurring/api/internal/config"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/migrations"
	"github.com/recurring/api/pkg/pgdocker"
	"gotest.tools/v3/assert"
)

const (
	constraintPrimaryKey = "PRIMARY KEY"
	constraintForeignKey = "FOREIGN KEY"
	constraintCheck      = "CHECK"
	constraintCascade    = "ON DELETE CASCADE"
	sqlDefaultRandom     = "gen_random_bytes(8)"
	sqlDefaultEncode     = "encode"
	sqlDefaultNow        = "now()"
	columnUserID         = "user_id"
	columnProjectID      = "project_id"
)

func TestMigrations(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	devConfig := mustLoadDevConfig(t)
	assertNoDownMigrations(t)

	ctr, err := pgdocker.Start(ctx, postgresConfig(devConfig.Db))
	assert.NilError(t, err, "start postgres")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		assert.NilError(t, ctr.Close(cleanupCtx), "close postgres")
	})

	db, err := sql.Open("pgx", ctr.ConnectionString("recurring_migration_test"))
	assert.NilError(t, err, "open postgres")
	defer func() {
		_ = db.Close()
	}()

	goose.SetBaseFS(migrations.SQLs)
	t.Cleanup(func() { goose.SetBaseFS(nil) })
	err = goose.SetDialect("postgres")
	assert.NilError(t, err, "set goose dialect")
	err = goose.UpContext(ctx, db, ".")
	assert.NilError(t, err, "goose up")

	version, err := goose.GetDBVersionContext(ctx, db)
	assert.NilError(t, err, "get goose version")
	assert.Equal(t, version, int64(5), "goose version")

	assertGooseAppliedVersion(ctx, t, db, 1)
	assertGooseAppliedVersion(ctx, t, db, 2)
	assertGooseAppliedVersion(ctx, t, db, 3)
	assertGooseAppliedVersion(ctx, t, db, 4)
	assertGooseAppliedVersion(ctx, t, db, 5)
	assertPgcrypto(ctx, t, db)
	assertGeneratedPrimaryKeyIDPolicy(ctx, t, db)
	assertExpenseColumns(ctx, t, db)
	assertExpenseConstraints(ctx, t, db)
	assertExpenseInsertBehavior(ctx, t, db)
	assertSignupColumns(ctx, t, db)
	assertSignupInsertBehavior(ctx, t, db)
	assertProjectColumns(ctx, t, db)
	assertProjectConstraints(ctx, t, db)
	assertProjectInsertBehavior(ctx, t, db)
	assertUsersProjectsColumns(ctx, t, db)
	assertUsersProjectsConstraints(ctx, t, db)
	assertUsersProjectsInsertBehavior(ctx, t, db)
}

func mustLoadDevConfig(t *testing.T) configgen.Config {
	t.Helper()

	cfg, err := config.Load(filepath.Join("..", "config", "test.yaml"))
	assert.NilError(t, err, "load dev config")
	return cfg
}

func postgresConfig(db configgen.DBConfig) pgdocker.Config {
	return pgdocker.Config{
		Database: db.Name,
		User:     db.User,
		Password: db.Password,
		SSLMode:  string(db.Sslmode),
	}
}

func assertNoDownMigrations(t *testing.T) {
	t.Helper()

	downAnnotation := regexp.MustCompile(`(?m)^\s*--\s+\+goose\s+Down(?:\s|$)`)
	err := fs.WalkDir(migrations.SQLs, ".", func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || path.Ext(file) != ".sql" {
			return nil
		}

		body, err := fs.ReadFile(migrations.SQLs, file)
		assert.NilError(t, err, "read migration %s", file)
		assert.Assert(t, !downAnnotation.Match(body), "migration %s contains +goose Down", file)
		return nil
	})
	assert.NilError(t, err, "walk migrations")
}

func assertGooseAppliedVersion(ctx context.Context, t *testing.T, db *sql.DB, version int64) {
	t.Helper()

	var applied bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.goose_db_version
			WHERE version_id = $1 AND is_applied
		)
	`, version).Scan(&applied)
	assert.NilError(t, err, "query goose version row")
	assert.Assert(t, applied, "goose version %d is not recorded as applied", version)
}

func assertPgcrypto(ctx context.Context, t *testing.T, db *sql.DB) {
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

func assertGeneratedPrimaryKeyIDPolicy(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT columns.table_name, columns.column_name, columns.column_default
		FROM information_schema.columns AS columns
		JOIN information_schema.key_column_usage AS key_columns
			ON key_columns.table_schema = columns.table_schema
			AND key_columns.table_name = columns.table_name
			AND key_columns.column_name = columns.column_name
		JOIN information_schema.table_constraints AS constraints
			ON constraints.constraint_schema = key_columns.constraint_schema
			AND constraints.constraint_name = key_columns.constraint_name
			AND constraints.table_schema = key_columns.table_schema
			AND constraints.table_name = key_columns.table_name
		WHERE columns.table_schema = 'public'
			AND constraints.constraint_type = 'PRIMARY KEY'
			AND columns.column_default LIKE '%gen_random_bytes%'
		ORDER BY columns.table_name, columns.column_name
	`)
	assert.NilError(t, err, "query generated primary key id columns")
	defer func() {
		_ = rows.Close()
	}()

	got := map[string]string{}
	for rows.Next() {
		var table string
		var column string
		var defaultValue string
		assert.NilError(t, rows.Scan(&table, &column, &defaultValue), "scan generated primary key id column")
		got[table+"."+column] = defaultValue
	}
	assert.NilError(t, rows.Err(), "iterate generated primary key id columns")

	want := map[string]string{
		"expenses.id": "exp_",
		"projects.id": "prj_",
		"sessions.id": "sess_",
		"users.id":    "usr_",
	}
	for name, prefix := range want {
		defaultValue, ok := got[name]
		assert.Assert(t, ok, "missing generated primary key id column %s", name)
		assertGeneratedPrimaryKeyDefault(t, name, defaultValue, prefix)
		assertIDCheckConstraint(ctx, t, db, name, prefix)
	}
	assert.Equal(t, len(got), len(want), "generated primary key id column count")
}

func assertGeneratedPrimaryKeyDefault(t *testing.T, name string, defaultValue string, prefix string) {
	t.Helper()

	assert.Assert(
		t,
		strings.Contains(defaultValue, prefix),
		"%s default = %q, want prefix %q",
		name,
		defaultValue,
		prefix,
	)
	assert.Assert(
		t,
		strings.Contains(defaultValue, sqlDefaultRandom),
		"%s default = %q, want %s",
		name,
		defaultValue,
		sqlDefaultRandom,
	)
	assert.Assert(
		t,
		strings.Contains(defaultValue, sqlDefaultEncode),
		"%s default = %q, want %s",
		name,
		defaultValue,
		sqlDefaultEncode,
	)
}

func assertIDCheckConstraint(ctx context.Context, t *testing.T, db *sql.DB, name string, prefix string) {
	t.Helper()

	table, _, ok := strings.Cut(name, ".")
	assert.Assert(t, ok, "generated id name %q is missing table separator", name)
	rows, err := db.QueryContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = $1::regclass AND contype = 'c'
	`, "public."+table)
	assert.NilError(t, err, "query %s check constraints", table)
	defer func() {
		_ = rows.Close()
	}()

	for rows.Next() {
		var definition string
		assert.NilError(t, rows.Scan(&definition), "scan %s check constraint", table)
		if !strings.Contains(definition, "^"+prefix) {
			continue
		}
		assert.Assert(t, !strings.Contains(definition, "[0-9a-f]"), "%s id check still constrains hex: %s", table, definition)
		assert.Assert(t, !strings.Contains(definition, "{32}"), "%s id check still constrains length: %s", table, definition)
		return
	}
	assert.NilError(t, rows.Err(), "iterate %s check constraints", table)
	assert.Assert(t, false, "%s is missing prefix-only id check for %q", table, prefix)
}

type columnInfo struct {
	dataType     string
	udtName      string
	nullable     string
	maxLength    sql.NullInt64
	defaultValue sql.NullString
}

func assertExpenseColumns(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'expenses'
		ORDER BY ordinal_position
	`)
	assert.NilError(t, err, "query expense columns")
	defer func() {
		_ = rows.Close()
	}()

	got := map[string]columnInfo{}
	var order []string
	for rows.Next() {
		var name string
		var col columnInfo
		err = rows.Scan(
			&name,
			&col.dataType,
			&col.udtName,
			&col.nullable,
			&col.maxLength,
			&col.defaultValue,
		)
		assert.NilError(t, err, "scan expense column")
		got[name] = col
		order = append(order, name)
	}
	assert.NilError(t, rows.Err(), "iterate expense columns")

	wantOrder := strings.Fields(
		"id name amount_minor currency recurring started_at category comment " +
			"cancel_url canceled_at created_at updated_at project_id",
	)
	assert.DeepEqual(t, order, wantOrder)

	assertColumn(t, got, "id", "text", "text", "NO", 0, []string{"exp_", sqlDefaultRandom, sqlDefaultEncode})
	assertColumn(t, got, "name", "text", "text", "NO", 0, nil)
	assertColumn(t, got, "amount_minor", "bigint", "int8", "NO", 0, nil)
	assertColumn(t, got, "currency", "character", "bpchar", "NO", 3, nil)
	assertColumn(t, got, "recurring", "interval", "interval", "YES", 0, nil)
	assertColumn(t, got, "started_at", "timestamp with time zone", "timestamptz", "NO", 0, nil)
	assertColumn(t, got, "category", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "comment", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "cancel_url", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "canceled_at", "timestamp with time zone", "timestamptz", "YES", 0, nil)
	assertColumn(t, got, "created_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
	assertColumn(t, got, "updated_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
	assertColumn(t, got, "project_id", "text", "text", "NO", 0, nil)
}

func assertColumn(
	t *testing.T,
	got map[string]columnInfo,
	name string,
	dataType string,
	udtName string,
	nullable string,
	maxLength int64,
	defaultParts []string,
) {
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
		assert.Assert(
			t,
			col.maxLength.Valid && col.maxLength.Int64 == maxLength,
			"column %s max length = %v, want %d",
			name,
			col.maxLength,
			maxLength,
		)
	}
	if len(defaultParts) == 0 && col.defaultValue.Valid {
		assert.Assert(t, !col.defaultValue.Valid, "column %s default = %q, want null", name, col.defaultValue.String)
	}
	for _, part := range defaultParts {
		assert.Assert(t, col.defaultValue.Valid, "column %s default = null, want substring %q", name, part)
		assert.Assert(
			t,
			strings.Contains(col.defaultValue.String, part),
			"column %s default = %q, want substring %q",
			name,
			col.defaultValue.String,
			part,
		)
	}
}

func assertExpenseConstraints(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'public.expenses'::regclass
	`)
	assert.NilError(t, err, "query expense constraints")
	defer func() {
		_ = rows.Close()
	}()

	var got []string
	for rows.Next() {
		var definition string
		assert.NilError(t, rows.Scan(&definition), "scan expense constraint")
		got = append(got, definition)
	}
	assert.NilError(t, rows.Err(), "iterate expense constraints")

	want := [][]string{
		{constraintPrimaryKey, "id"},
		{constraintCheck, "^exp_"},
		{constraintCheck, "length(name) > 0"},
		{constraintCheck, "amount_minor >= 0"},
		{constraintCheck, "^[A-Z]{3}$"},
		{constraintCheck, "recurring > '00:00:00'::interval"},
		{constraintCheck, "length(category) > 0"},
		{constraintCheck, "length(comment) > 0"},
		{constraintForeignKey, columnProjectID, "projects(id)", constraintCascade},
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

func assertExpenseInsertBehavior(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	projectID := createProjectForTest(ctx, t, db, "expense-project-owner@example.com", "Expenses")

	var id string
	err := db.QueryRowContext(ctx, `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, project_id)
		VALUES ('Rent', 125000, 'USD', now(), $1)
		RETURNING id
	`, projectID).Scan(&id)
	assert.NilError(t, err, "insert valid expense")
	assertGeneratedID(t, id, "exp", "generated id")

	assertInsertRejected(ctx, t, db, "negative amount_minor", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, project_id)
		VALUES ('Rent', -1, 'USD', now(), $1)
	`, projectID)
	assertInsertRejected(ctx, t, db, "lowercase currency", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, project_id)
		VALUES ('Rent', 1, 'usd', now(), $1)
	`, projectID)
	assertInsertRejected(ctx, t, db, "empty name", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, project_id)
		VALUES ('', 1, 'USD', now(), $1)
	`, projectID)
	assertInsertRejected(ctx, t, db, "empty category", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, category, project_id)
		VALUES ('Rent', 1, 'USD', now(), '', $1)
	`, projectID)
	assertInsertRejected(ctx, t, db, "empty comment", `
		INSERT INTO public.expenses (name, amount_minor, currency, started_at, comment, project_id)
		VALUES ('Rent', 1, 'USD', now(), '', $1)
	`, projectID)
}

func assertInsertRejected(ctx context.Context, t *testing.T, db *sql.DB, name string, query string, args ...any) {
	t.Helper()

	_, err := db.ExecContext(ctx, query, args...)
	assert.Assert(t, err != nil, "%s insert succeeded, want constraint error", name)
	assert.Assert(
		t,
		strings.Contains(err.Error(), "SQLSTATE 23514"),
		"%s insert error = %v, want check violation",
		name,
		err,
	)
}

func assertGeneratedID(t *testing.T, id string, prefix string, label string) {
	t.Helper()

	pattern := fmt.Sprintf(`^%s_[0-9a-f]+$`, prefix)
	assert.Assert(
		t,
		regexp.MustCompile(pattern).MatchString(id),
		"%s = %q, want %s plus lowercase hex chars",
		label,
		id,
		prefix,
	)
}

func assertSignupColumns(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT table_name, column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name IN ('users', 'sessions')
		ORDER BY table_name, ordinal_position
	`)
	assert.NilError(t, err, "query signup columns")
	defer func() {
		_ = rows.Close()
	}()

	got := map[string]columnInfo{}
	var order []string
	for rows.Next() {
		var table string
		var column string
		var col columnInfo
		err = rows.Scan(
			&table,
			&column,
			&col.dataType,
			&col.udtName,
			&col.nullable,
			&col.maxLength,
			&col.defaultValue,
		)
		assert.NilError(t, err, "scan signup column")
		name := table + "." + column
		got[name] = col
		order = append(order, name)
	}
	assert.NilError(t, rows.Err(), "iterate signup columns")

	want := []string{
		"sessions.id",
		"sessions.user_id",
		"sessions.created_at",
		"sessions.expires_at",
		"users.id",
		"users.google_sub",
		"users.email",
		"users.name",
		"users.picture_url",
		"users.created_at",
		"users.updated_at",
	}
	assert.DeepEqual(t, order, want)

	assertSessionColumns(t, got)
	assertUserColumns(t, got)
}

func assertSessionColumns(t *testing.T, got map[string]columnInfo) {
	t.Helper()

	assertColumn(t, got, "sessions.id", "text", "text", "NO", 0, []string{"sess_", sqlDefaultRandom, sqlDefaultEncode})
	assertColumn(t, got, "sessions.user_id", "text", "text", "NO", 0, nil)
	assertColumn(
		t,
		got,
		"sessions.created_at",
		"timestamp with time zone",
		"timestamptz",
		"NO",
		0,
		[]string{sqlDefaultNow},
	)
	assertColumn(
		t,
		got,
		"sessions.expires_at",
		"timestamp with time zone",
		"timestamptz",
		"NO",
		0,
		[]string{sqlDefaultNow, "interval"},
	)
}

func assertUserColumns(t *testing.T, got map[string]columnInfo) {
	t.Helper()

	assertColumn(t, got, "users.id", "text", "text", "NO", 0, []string{"usr_", sqlDefaultRandom, sqlDefaultEncode})
	assertColumn(t, got, "users.google_sub", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "users.email", "text", "text", "NO", 0, nil)
	assertColumn(t, got, "users.name", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "users.picture_url", "text", "text", "YES", 0, nil)
	assertColumn(t, got, "users.created_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
	assertColumn(t, got, "users.updated_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
}

func assertSignupInsertBehavior(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	var userID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO public.users (google_sub, email, name, picture_url)
		VALUES ('google-sub-1', 'user@example.com', 'Example User', 'https://example.com/avatar.png')
		RETURNING id
	`).Scan(&userID)
	assert.NilError(t, err, "insert valid user")
	assertGeneratedID(t, userID, "usr", "generated user id")

	var userWithoutGoogleSubID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO public.users (email)
		VALUES ('user-without-google-sub@example.com')
		RETURNING id
	`).Scan(&userWithoutGoogleSubID)
	assert.NilError(t, err, "insert user without google_sub")
	assertGeneratedID(t, userWithoutGoogleSubID, "usr", "generated user id")

	var sessionID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO public.sessions (user_id)
		VALUES ($1)
		RETURNING id
	`, userID).Scan(&sessionID)
	assert.NilError(t, err, "insert valid session")
	assertGeneratedID(t, sessionID, "sess", "generated session id")

	assertInsertRejected(ctx, t, db, "empty google_sub", `
		INSERT INTO public.users (google_sub, email)
		VALUES ('', 'user@example.com')
	`)
	assertInsertRejected(ctx, t, db, "empty email", `
		INSERT INTO public.users (google_sub, email)
		VALUES ('google-sub-2', '')
	`)
}

func assertProjectColumns(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'projects'
		ORDER BY ordinal_position
	`)
	assert.NilError(t, err, "query project columns")
	defer func() {
		_ = rows.Close()
	}()

	got := map[string]columnInfo{}
	var order []string
	for rows.Next() {
		var name string
		var col columnInfo
		err = rows.Scan(
			&name,
			&col.dataType,
			&col.udtName,
			&col.nullable,
			&col.maxLength,
			&col.defaultValue,
		)
		assert.NilError(t, err, "scan project column")
		got[name] = col
		order = append(order, name)
	}
	assert.NilError(t, rows.Err(), "iterate project columns")

	want := []string{
		"id",
		"name",
		"archived_at",
		"created_at",
		"updated_at",
	}
	assert.DeepEqual(t, order, want)

	assertColumn(t, got, "id", "text", "text", "NO", 0, []string{"prj_", sqlDefaultRandom, sqlDefaultEncode})
	assertColumn(t, got, "name", "text", "text", "NO", 0, nil)
	assertColumn(t, got, "archived_at", "timestamp with time zone", "timestamptz", "YES", 0, nil)
	assertColumn(t, got, "created_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
	assertColumn(t, got, "updated_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
}

func assertProjectConstraints(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'public.projects'::regclass
	`)
	assert.NilError(t, err, "query project constraints")
	defer func() {
		_ = rows.Close()
	}()

	var got []string
	for rows.Next() {
		var definition string
		assert.NilError(t, rows.Scan(&definition), "scan project constraint")
		got = append(got, definition)
	}
	assert.NilError(t, rows.Err(), "iterate project constraints")

	want := [][]string{
		{"PRIMARY KEY", "id"},
		{constraintCheck, "^prj_"},
		{constraintCheck, "length(name) > 0"},
	}
	for _, parts := range want {
		assertConstraintDefinition(t, got, parts)
	}
}

func assertProjectInsertBehavior(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	var userID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO public.users (email)
		VALUES ('project-owner@example.com')
		RETURNING id
	`).Scan(&userID)
	assert.NilError(t, err, "insert project owner")

	var projectID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO public.projects (name, archived_at)
		VALUES ('Home', now())
		RETURNING id
	`).Scan(&projectID)
	assert.NilError(t, err, "insert valid project")
	assertGeneratedID(t, projectID, "prj", "generated project id")

	_, err = db.ExecContext(ctx, `
		INSERT INTO public.users_projects (user_id, project_id, role)
		VALUES ($1, $2, 'owner')
	`, userID, projectID)
	assert.NilError(t, err, "insert valid users_projects link")

	assertInsertRejected(ctx, t, db, "empty project name", `
		INSERT INTO public.projects (name)
		VALUES ('')
	`)
}

func createProjectForTest(ctx context.Context, t *testing.T, db *sql.DB, ownerEmail string, projectName string) string {
	t.Helper()

	var userID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO public.users (email)
		VALUES ($1)
		RETURNING id
	`, ownerEmail).Scan(&userID)
	assert.NilError(t, err, "insert project owner")

	var projectID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO public.projects (name)
		VALUES ($1)
		RETURNING id
	`, projectName).Scan(&projectID)
	assert.NilError(t, err, "insert project")
	assertGeneratedID(t, projectID, "prj", "generated project id")

	_, err = db.ExecContext(ctx, `
		INSERT INTO public.users_projects (user_id, project_id, role)
		VALUES ($1, $2, 'owner')
	`, userID, projectID)
	assert.NilError(t, err, "insert users_projects link")

	return projectID
}

func assertUsersProjectsColumns(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'users_projects'
		ORDER BY ordinal_position
	`)
	assert.NilError(t, err, "query users_projects columns")
	defer func() {
		_ = rows.Close()
	}()

	got := map[string]columnInfo{}
	var order []string
	for rows.Next() {
		var name string
		var col columnInfo
		err = rows.Scan(
			&name,
			&col.dataType,
			&col.udtName,
			&col.nullable,
			&col.maxLength,
			&col.defaultValue,
		)
		assert.NilError(t, err, "scan users_projects column")
		got[name] = col
		order = append(order, name)
	}
	assert.NilError(t, rows.Err(), "iterate users_projects columns")

	want := []string{
		columnUserID,
		columnProjectID,
		"role",
		"created_at",
	}
	assert.DeepEqual(t, order, want)

	assertColumn(t, got, columnUserID, "text", "text", "NO", 0, nil)
	assertColumn(t, got, columnProjectID, "text", "text", "NO", 0, nil)
	assertColumn(t, got, "role", "text", "text", "NO", 0, nil)
	assertColumn(t, got, "created_at", "timestamp with time zone", "timestamptz", "NO", 0, []string{sqlDefaultNow})
}

func assertUsersProjectsConstraints(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	rows, err := db.QueryContext(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'public.users_projects'::regclass
	`)
	assert.NilError(t, err, "query users_projects constraints")
	defer func() {
		_ = rows.Close()
	}()

	var got []string
	for rows.Next() {
		var definition string
		assert.NilError(t, rows.Scan(&definition), "scan users_projects constraint")
		got = append(got, definition)
	}
	assert.NilError(t, rows.Err(), "iterate users_projects constraints")

	want := [][]string{
		{constraintPrimaryKey, columnUserID, columnProjectID},
		{constraintCheck, "length(role) > 0"},
		{constraintForeignKey, columnUserID, "users(id)", constraintCascade},
		{constraintForeignKey, columnProjectID, "projects(id)", constraintCascade},
	}
	for _, parts := range want {
		assertConstraintDefinition(t, got, parts)
	}
}

func assertUsersProjectsInsertBehavior(ctx context.Context, t *testing.T, db *sql.DB) {
	t.Helper()

	var userID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO public.users (email)
		VALUES ('users-projects-owner@example.com')
		RETURNING id
	`).Scan(&userID)
	assert.NilError(t, err, "insert users_projects owner")

	var projectID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO public.projects (name)
		VALUES ('Users Projects')
		RETURNING id
	`).Scan(&projectID)
	assert.NilError(t, err, "insert users_projects project")

	_, err = db.ExecContext(ctx, `
		INSERT INTO public.users_projects (user_id, project_id, role)
		VALUES ($1, $2, 'owner')
	`, userID, projectID)
	assert.NilError(t, err, "insert users_projects")

	var projectWithoutRoleID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO public.projects (name)
		VALUES ('Users Projects Missing Role')
		RETURNING id
	`).Scan(&projectWithoutRoleID)
	assert.NilError(t, err, "insert users_projects missing role project")

	assertInsertRejected(ctx, t, db, "empty users_projects role", `
		INSERT INTO public.users_projects (user_id, project_id, role)
		VALUES ($1, $2, '')
	`, userID, projectWithoutRoleID)
}
