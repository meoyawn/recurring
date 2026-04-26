# Postgres Plan

## Decisions

- Migrations: `pressly/goose`.
- Runtime driver: `pgx/v5` with `pgxpool`.
- Migration driver path: short-lived `database/sql` handle using `github.com/jackc/pgx/v5/stdlib`.
- Query generation: `pggen`.
- Query style: raw SQL files, generated raw typed Go wrappers, no ORM.
- Local/codegen database: Postgres in Compose.

## Why `pggen`

Use `pggen` because this project wants PgTyped-style query generation:

- Raw SQL remains source of truth.
- Postgres is available in Compose during codegen.
- Queries may use Postgres-heavy features: CTEs, JSON, arrays, enums, extensions, custom functions, `RETURNING`, lateral joins, and unusual expressions.
- Runtime API can use `pgx`.
- No ORM/model layer is wanted.

`pggen` is a better fit than `sqlc` for live Postgres-backed type analysis.

`sqlc` remains the boring default in much of Go, but its default analysis is static over schema/query files. It can use database-backed analysis, but that is an opt-in enhancement. `pggen` is designed around Postgres-backed query analysis.

## Postgres Type Analysis Terms

The Postgres-side mechanism is parse analysis / type resolution.

For parameters:

- Postgres can infer `$1`, `$2`, etc. types during `PREPARE` or extended-protocol `Parse` when parameter types are omitted or `unknown`.

For result columns:

- Clients use extended-protocol `Describe` metadata.
- `ParameterDescription` describes parameters.
- `RowDescription` describes returned columns.

This is not `ANALYZE`. `ANALYZE` updates planner statistics.

## Migration Library

Use `pressly/goose` for API schema migrations.

Reasons:

- Library and CLI both supported.
- Same migration files work for embedded startup migrations and later ops-run migrations.
- SQL files stay in `apps/api/migrations`.
- Embedded migrations work with `go:embed`.
- Go migrations remain possible later, but default should be SQL.
- Postgres locking support exists for concurrent deploys.

Do not use `golang-migrate` unless paired `.up.sql` / `.down.sql` files become a hard requirement.

## Runtime Execution Model

API server runs migrations during startup, before listening for requests.

Startup order:

1. Read config.
2. Open short-lived `database/sql` connection from `DATABASE_URL` using pgx stdlib.
3. Ping database.
4. Run `goose up`.
5. Close migration connection.
6. Open long-lived `pgxpool.Pool` from `DATABASE_URL`.
7. Start HTTP server.

If migration fails, process exits non-zero. Systemd/deploy tooling can retry after the issue is fixed.

Keep migration connection lifecycle separate from runtime pool lifecycle.

## Codegen Execution Model

`pggen` needs a Postgres database during generation.

Local/codegen flow:

1. Start Compose Postgres.
2. Run goose migrations against the Compose database.
3. Run `pggen` against the migrated database and SQL query files.
4. Commit generated Go code.
5. Run Go tests.

Generation should use the same migration files as runtime startup.

## Future Ops Execution Model

Keep migration files compatible with goose CLI so execution can move out of API code later.

Future ops command shape:

```bash
goose -dir apps/api/migrations postgres "$DATABASE_URL" up
goose -dir apps/api/migrations postgres "$DATABASE_URL" status
```

Migration ownership can move from API startup to Ansible, CI, or a one-shot systemd unit without rewriting migration files.

## File Layout

Keep canonical SQL migrations here:

```text
apps/api/migrations/
```

Keep SQL queries here:

```text
apps/api/queries/
```

Generated query code should live under:

```text
apps/api/internal/store/
```

Use one SQL file per migration:

```text
20260426120000_create_accounts.sql
```

Migration file format:

```sql
-- +goose Up
CREATE TABLE accounts (
  id uuid PRIMARY KEY
);

-- +goose Down
DROP TABLE accounts;
```

## Go Package Shape

When implemented:

```text
apps/api/internal/db/
apps/api/internal/migrator/
apps/api/internal/store/
apps/api/migrations/
apps/api/queries/
```

`internal/db`:

- Opens runtime `pgxpool.Pool`.
- Requires `DATABASE_URL`.
- Pings before returning.
- Owns pool close at API shutdown.

`internal/migrator`:

- Opens short-lived `database/sql` handle using pgx stdlib.
- Imports embedded migration FS.
- Sets goose dialect to `postgres`.
- Runs `goose.UpContext`.
- Closes migration handle before runtime pool starts.
- Returns wrapped errors.

`internal/store`:

- Holds generated `pggen` query wrappers.
- Uses `pgx` types and connection interfaces.
- Contains no hand-written ORM layer.

`apps/api/migrations`:

- Holds SQL migrations.
- May include a tiny Go file only for embedding if startup migrations remain in-process.

`apps/api/queries`:

- Holds hand-written SQL query files consumed by `pggen`.

## Config

Required:

```text
DATABASE_URL=postgres://recurring:recurring@127.0.0.1:5432/recurring?sslmode=disable
```

Existing:

```text
RECURRING_API_ADDR=:8080
```

Optional future escape hatch:

```text
RECURRING_API_MIGRATIONS=disable
```

Use the escape hatch only after ops owns migration execution.

## Zero Downtime Rules

Startup migrations must be expand-only.

Allowed during API startup:

- Create table.
- Add nullable column.
- Add column with safe default only when table size is known small.
- Add index concurrently when needed.
- Add constraint as `NOT VALID`.
- Validate existing constraint in separate migration when safe.

Not allowed during API startup:

- Drop table.
- Drop column.
- Rename table or column.
- Rewrite large tables.
- Add non-null column without staged backfill.
- Change column type when rewrite risk exists.

Destructive or contract migrations need separate ops plan and deploy sequencing.

## Deploy Pattern

Use expand/contract.

1. Expand schema.
2. Deploy API compatible with old and new schema.
3. Backfill data if needed.
4. Switch reads/writes.
5. Deploy cleanup only after old API version cannot run.

## Immediate Implementation Steps

1. Add `github.com/pressly/goose/v3`.
2. Add `github.com/jackc/pgx/v5`.
3. Add `github.com/jackc/pgx/v5/stdlib`.
4. Add `internal/migrator` with short-lived migration handle.
5. Add `internal/db` with runtime `pgxpool`.
6. Wire `cmd/api/main.go` to run migrations before opening runtime pool and listening.
7. Add `apps/api/queries`.
8. Add `pggen` generation command after first table/query exists.
9. Add first real migration when first table is designed.
10. Add `go test ./...` verification.
