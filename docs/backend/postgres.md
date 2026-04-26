# Postgres Plan

## Decisions

- Runtime driver: `github.com/jackc/pgx/v5`.
- Runtime pool: `github.com/jackc/pgx/v5/pgxpool`.
- Migrations: `github.com/pressly/goose/v3`.
- Migration driver path: short-lived `database/sql` handle using
  `github.com/jackc/pgx/v5/stdlib`.
- Query generation: `pggen`.
- Query style: raw SQL files, generated typed Go wrappers, no ORM.
- Local/codegen database: Postgres in Compose or another local Postgres
  instance.
- Generated query Go code is committed.
- Ordinary build should not require a running Postgres server.
- Query tests use sandboxed Postgres transactions.
- E2E tests may use `testcontainers-go` to own a full temporary Postgres server.

## Why `pggen`

Use `pggen` because this project wants PgTyped-style query generation:

- Raw SQL remains source of truth.
- Codegen can require a running migrated Postgres database.
- Queries may use Postgres-heavy features: CTEs, JSON, arrays, enums,
  extensions, custom functions, `RETURNING`, lateral joins, and unusual
  expressions.
- Runtime API can use `pgx`.
- No ORM/model layer is wanted.

`pggen` is preferred over `sqlc` for this project because `pggen` is designed
around running queries against Postgres and using Postgres catalog/type
metadata.

`sqlc` remains the mature default in much of Go and can use database-backed
analysis, but this project accepts `pggen`'s lower adoption in exchange for
stronger alignment with running-Postgres type inference.

Known `pggen` tradeoffs:

- Lower adoption than `sqlc`.
- Module is not a stable v1 API.
- Generated Go must be committed.
- Nullability inference may need review around complex queries.

Mitigation:

- Keep generated code in `apps/api/internal/store`.
- Verify generated code in CI by regenerating against a migrated database and
  failing on diff.
- Review nullable generated types during query review.

## Postgres Type Analysis Terms

The Postgres-side mechanism is parse analysis / type resolution.

For parameters:

- Postgres can infer `$1`, `$2`, etc. types during `PREPARE` or
  extended-protocol `Parse` when parameter types are omitted or `unknown`.

For result columns:

- Clients use extended-protocol `Describe` metadata.
- `ParameterDescription` describes parameters.
- `RowDescription` describes returned columns.

This is not `ANALYZE`. `ANALYZE` updates planner statistics.

## Migration Library

Use `pressly/goose` for API schema migrations.

Reasons:

- Library and CLI both supported.
- Same migration files work for embedded startup migrations and later ops-run
  migrations.
- SQL files stay in `apps/api/migrations`.
- Embedded migrations work with `go:embed`.
- Go migrations remain possible later, but default should be SQL.
- Postgres locking support exists for concurrent deploys.

Do not use `golang-migrate` unless paired `.up.sql` / `.down.sql` files become a
hard requirement.

## Runtime Execution Model

API server runs migrations during startup, before listening for requests.

Startup order:

1. Read config.
2. Open short-lived `database/sql` connection from `DATABASE_URL` using pgx
   stdlib.
3. Ping database.
4. Run `goose up`.
5. Close migration connection.
6. Open long-lived `pgxpool.Pool` from `DATABASE_URL`.
7. Start HTTP server.

If migration fails, process exits non-zero. Systemd/deploy tooling can retry
after the issue is fixed.

Keep migration connection lifecycle separate from runtime pool lifecycle.

Startup migrations must run before the HTTP listener starts serving accepted
requests. In production, systemd may already own the socket and queue incoming
connections, but the API process must not accept them until migrations and pool
startup have completed.

Runtime database calls must take the request context from Echo/`net/http`.
Request handlers must not use `context.Background()` for pgx calls. During
shutdown, request contexts should cancel in-flight queries when clients
disconnect or when the HTTP shutdown timeout expires.

## Codegen Execution Model

`pggen` needs a migrated Postgres database during generation.

Local/codegen flow:

1. Start Compose Postgres or provide a local `DATABASE_URL`.
2. Run goose migrations against the codegen database.
3. Run `pggen` against the migrated database and SQL query files.
4. Commit generated Go code.
5. Run Go tests.

Generation should use the same migration files as runtime startup.

Ordinary `go test ./...` should not regenerate query code. A dedicated codegen
verification task should regenerate and fail on dirty diff.

## Test Execution Model

Database tests use real Postgres.

Schema setup:

1. Start or connect to one test Postgres server.
2. Run migrations once before DB tests.
3. Reuse the migrated schema for all tests.

Per-test sandbox:

1. Acquire one dedicated connection.
2. Begin a transaction.
3. Pass that `pgx.Tx` or a tx-backed query dependency into code under test.
4. Run test.
5. Roll back transaction in cleanup.
6. Release connection.

Rules:

- No per-test migrations.
- No per-test containers.
- Each test must be isolated by rollback.
- Tests must not depend on rows created by another test.
- Query tests should be idempotent against any migrated test database.
- Tests using `t.Parallel()` need their own connection and transaction.
- Code under test should accept a transaction-capable query dependency instead
  of hard-coding `*pgxpool.Pool`.

Recommended query-test helper shape:

```text
testdb.Start(ctx)
testdb.Migrate(ctx)
testdb.Tx(t)
```

`testdb.Tx(t)` should return a generated querier or a small struct containing:

```text
Conn pgx.Tx
Store *store.DBQuerier
```

`pggen` generated queriers can be created over `pgx.Tx`, `*pgx.Conn`, or
`*pgxpool.Pool`, so production code can use the pool and tests can use a
transaction.

## Test Database Provisioning

Query/data-layer tests should not care how Postgres is provisioned.

Supported options:

- External `DATABASE_URL`, usually Compose Postgres.
- One automatically started Postgres container per package or suite.

E2E tests may use `testcontainers-go` because E2E tests benefit from owning
their dependency lifecycle.

Do not start one container per test.

## Future Ops Execution Model

Keep migration files compatible with goose CLI so execution can move out of API
code later.

Future ops command shape:

```bash
goose -dir apps/api/migrations postgres "$DATABASE_URL" up
goose -dir apps/api/migrations postgres "$DATABASE_URL" status
```

Migration ownership can move from API startup to Ansible, CI, or a one-shot
systemd unit without rewriting migration files.

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

Test DB helpers should live near API tests:

```text
apps/api/internal/testdb/
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
apps/api/internal/testdb/
apps/api/migrations/
apps/api/queries/
```

`internal/db`:

- Opens runtime `pgxpool.Pool`.
- Requires `DATABASE_URL`.
- Pings before returning.
- Owns pool close at API shutdown.
- Closes the pool after HTTP drain or shutdown timeout, not before handlers have
  had a chance to finish.

`internal/migrator`:

- Opens short-lived `database/sql` handle using pgx stdlib.
- Imports embedded migration FS.
- Sets goose dialect to `postgres`.
- Runs `goose.UpContext`.
- Uses a bounded startup context so failed or stuck migrations do not leave the
  service in an indefinite activating state.
- Closes migration handle before runtime pool starts.
- Returns wrapped errors.

`internal/store`:

- Holds generated `pggen` query wrappers.
- Uses `pgx` types and connection interfaces.
- Contains no hand-written ORM layer.

`internal/testdb`:

- Provides DB test setup.
- Runs migrations once per test database.
- Opens one transaction per test.
- Rolls back each test transaction during cleanup.
- May connect to external `DATABASE_URL` or use one suite container.

`apps/api/migrations`:

- Holds SQL migrations.
- May include a tiny Go file only for embedding if startup migrations remain
  in-process.

`apps/api/queries`:

- Holds hand-written SQL query files consumed by `pggen`.

## Config

Required for runtime:

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

Optional for tests:

```text
RECURRING_TEST_DATABASE_URL=postgres://recurring:recurring@127.0.0.1:5432/recurring_test?sslmode=disable
```

If omitted, test helper may use `DATABASE_URL` for local query tests or start an
E2E-owned container when that test mode is selected.

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

Socket activation only queues new, unaccepted API connections during startup or
restart. It does not protect accepted requests from incompatible schema changes,
and long startup migrations can still exhaust listener backlog or client
timeouts. Keep startup migrations short; move long backfills, validation, and
contract work to explicit ops steps.

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
6. Wire `cmd/api/main.go` to run migrations before opening runtime pool and
   listening.
7. Add `apps/api/queries`.
8. Add `pggen` generation command after first table/query exists.
9. Commit generated query Go code.
10. Add `internal/testdb` with migrate-once and transaction-per-test helpers.
11. Add first real migration when first table is designed.
12. Add `go test ./...` verification.
13. Add codegen verification task that starts/migrates Postgres, runs `pggen`,
    and fails on generated-code diff.
