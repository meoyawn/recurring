# V1 Expenses Migration

Decision: write the first goose SQL migration under `apps/api/migrations`.
It creates the core `expenses` table for `/v1/session/expenses`.

Runtime migration wiring belongs to [env.md](env.md): config loading, Postgres
URL derivation, pgx stdlib migration connection, goose startup execution, and
pgxpool startup. This spike owns only the v1 migration SQL and its migration
test.

## Success Criteria

The v1 migration is verified by a disposable Postgres migration test.

Status: unresolved until `apps/api/migrations/00001_init.sql` exists and a Go
test starts disposable Postgres with Testcontainers, migrates to goose version
`00001`, and verifies the resulting schema and insert-time behavior.

Implementation success criteria:

- `apps/api/migrations/00001_init.sql` is a non-empty goose SQL migration.
- The migration creates `pgcrypto`.
- The migration creates `public.expenses` with this v1 schema:
  `id text PRIMARY KEY DEFAULT 'exp_' || encode(gen_random_bytes(16), 'hex')`
  constrained by `^exp_[0-9a-f]{32}$`; `name text NOT NULL` constrained to
  non-empty; `amount_minor bigint NOT NULL` constrained to `>= 0`;
  `currency char(3) NOT NULL` constrained by `^[A-Z]{3}$`;
  `recurring interval NULL` constrained to positive values when present;
  `started_at timestamptz NOT NULL`; nullable `category text` and `comment text`
  constrained to non-empty values when present; nullable `cancel_url text`;
  nullable `canceled_at timestamptz`; `created_at timestamptz NOT NULL DEFAULT
  now()`; and `updated_at timestamptz NOT NULL DEFAULT now()`.
- A Go test starts disposable Postgres with Testcontainers.
- The test applies exact goose target version `00001`.
- The test verifies goose records version `00001` as applied.
- The test verifies `public.expenses` columns, nullability, types, defaults,
  and constraints match the API shape.
- The test verifies representative insert behavior: generated ids match
  `^exp_[0-9a-f]{32}$`, negative `amount_minor` is rejected, lowercase
  `currency` is rejected, empty `name` is rejected, empty `category` is
  rejected, and empty `comment` is rejected.
- Verification uses only throwaway/dev credentials and never commits expanded
  Postgres URLs in tasks, docs, tests, or logs.

## Evidence

Local evidence:

- `packages/openapi/spec/recurring.responsible.ts` defines
  `/v1/session/expenses`.
- `packages/openapi/spec/shared.responsibe.ts` defines money as non-negative
  minor-unit `int64` plus uppercase three-letter currency.
- `spikes/backend/init.sql` contains the proposed v1 `expenses` table body.
- `spikes/backend/postgres.md` decides on `pgx`, `pgxpool`, `goose`, SQL
  migrations in `apps/api/migrations`, and startup migrations before serving
  requests.

External evidence:

- Goose Provider runs migrations from Go with a `database/sql` handle and
  exposes version inspection:
  https://pressly.github.io/goose/documentation/provider/
- Goose documents ordinary migration integration tests against ephemeral
  Postgres containers: https://pressly.github.io/goose/blog/2021/better-tests/
- Testcontainers for Go has a Postgres module that starts disposable Postgres
  and returns connection strings:
  https://golang.testcontainers.org/modules/postgres/
- PostgreSQL `information_schema` and `pg_constraint` expose table, column, and
  constraint metadata:
  https://www.postgresql.org/docs/18/information-schema.html
  https://www.postgresql.org/docs/current/catalog-pg-constraint.html
- PostgreSQL stores `timestamptz` instants internally in UTC:
  https://www.postgresql.org/docs/current/datatype-datetime.html

## Table Shape

Write `apps/api/migrations/00001_init.sql` from the proposed body in
[init.sql](init.sql).

Required mapping:

- API `id` becomes an opaque `text` primary key with `exp_` prefix and a
  lowercase hex suffix generated from 16 random bytes.
- API `name` becomes non-empty `text`.
- API `money.amount` becomes non-negative `amount_minor bigint`.
- API `money.currency` becomes uppercase `currency char(3)`.
- API optional `recurring` becomes nullable positive PostgreSQL `interval`.
  App validation still owns RFC 3339 duration compatibility before insert.
- API Unix millisecond timestamps become `timestamptz` and are converted at the
  API boundary.
- `created_at` and `updated_at` come from `DbTimestamps` and default to `now()`.

Ownership/session foreign keys are deferred until the auth/session migration.
The v1 migration only proves migration plumbing and creates core expense
storage.

## Test Shape

Use a Go integration test, not local Compose, as the proof.

Expected flow:

1. Start disposable Postgres with Testcontainers.
2. Open a `database/sql` connection for goose.
3. Run goose against `apps/api/migrations` to target version `00001`.
4. Assert goose database version is `00001`.
5. Query PostgreSQL metadata to assert `public.expenses` schema.
6. Run insert attempts that prove required constraints and generated id format.

Local Compose plus goose CLI can remain a manual smoke check, but it is not the
success criterion.

## Open Questions

None.

## Criterion Status

`The v1 migration is verified by a disposable Postgres migration test`:
unresolved.

It is answered when a Testcontainers-backed Go test applies
`apps/api/migrations/00001_init.sql` to goose version `00001` and verifies the
`expenses` table schema and insert-time behavior against that disposable
database.
