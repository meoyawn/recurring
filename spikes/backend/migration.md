# API Migration Schema Decision

Decision: the first goose migration creates the core `expenses` table and is
verified against local Compose Postgres with the goose CLI.

Runtime migration setup belongs to [env.md](env.md): API config loading,
Postgres URL derivation, pgx stdlib migration connection, goose startup
execution, and pgxpool startup. This spike owns schema design.

## Success Criteria

Local Compose Postgres is successfully migrated with the goose CLI.

Status: unresolved until the first SQL migration exists under
`apps/api/migrations` and `goose up` has been run against the local Compose
database.

Implementation success criteria:

- `apps/api/migrations` contains a non-empty SQL migration for `expenses`.
- The migration applies cleanly to `compose/docker-compose.yml` Postgres.
- Goose records the applied migration in its version table.
- The resulting database contains the `expenses` table with constraints matching
  the API shape.
- Verification uses local throwaway/dev credentials only and does not put the
  expanded Postgres URL in committed tasks, docs, or logs.

## Sources

Local evidence:

- `compose/docker-compose.yml` defines local Postgres on host port `5432` with
  database, user, and password all set to `recurring`.
- `packages/openapi/spec/recurring.responsible.ts` defines the expense shape
  exposed by `/v1/session/expenses`.
- `packages/openapi/spec/shared.responsibe.ts` defines money as minor-unit
  `int64` amount plus ISO-style three-letter currency.
- [env.md](env.md) decides that API startup derives the Postgres URL in memory,
  runs goose migrations, closes the migration connection, then opens `pgxpool`.
- `spikes/backend/postgres.md` decides on `pgx`, `pgxpool`, `goose`, SQL
  migrations in `apps/api/migrations`, and startup migrations before serving
  requests.

External evidence:

- `goose up` applies all available migrations:
  https://pressly.github.io/goose/documentation/cli-commands/#up
- PostgreSQL 18 stores both `timestamp` and `timestamp with time zone` in 8
  bytes with 1 microsecond resolution, stores `interval` in 16 bytes, stores
  timezone-aware timestamps internally in UTC, and converts them to the session
  timezone for output:
  https://www.postgresql.org/docs/current/datatype-datetime.html
- PostgreSQL 18 stores `bigint` in 8 bytes, with signed range
  `-9223372036854775808` to `+9223372036854775807`:
  https://www.postgresql.org/docs/current/datatype-numeric.html
- Stripe uses string object ids such as customer `cus_...` and subscription
  `sub_...`; its API docs define these ids as strings:
  https://docs.stripe.com/api/customers/object and
  https://docs.stripe.com/api/subscriptions/object

## Table Shape

Do not leave migrations empty. Add a first SQL migration with at least an
`expenses` table based on `recurring.responsible.ts`.

Suggested table shape: [init.sql](init.sql).

Mapping:

- API `id` should be an opaque Stripe-style string id. Use the `exp_` prefix
  because this table stores expenses; no repo evidence shows a prior local
  prefix convention. The suffix is 16 random bytes rendered as lowercase hex so
  Postgres can generate it with `pgcrypto` and a simple CHECK constraint.
- API `money.amount` becomes `amount_minor bigint`.
- API `money.currency` becomes `currency char(3)`.
- API `recurring` is optional and becomes nullable PostgreSQL `interval`;
  app-level validation still owns RFC 3339 duration compatibility before
  inserting.
- API Unix millisecond timestamps are represented in Postgres as `timestamptz`
  and converted to/from Unix milliseconds at the API boundary. Plain `timestamp`
  is not UTC milliseconds; it is a date-time without timezone.
- `created_at` and `updated_at` come from the existing `DbTimestamps` shape and
  use `now()` for database-generated timestamps.

Timestamp storage decision:

- Observation: PostgreSQL documents both plain `timestamp` and timezone-aware
  `timestamptz` as 8-byte types, and documents `bigint` as an 8-byte type.
  Storage size does not favor either representation.
- Observation: PostgreSQL documents timezone-aware timestamps as stored
  internally in UTC, then converted to the session timezone for output. Plain
  `timestamp` does not carry timezone semantics.
- Recommendation: use `timestamptz` for stored instants. It keeps native
  date/time operators and SQL defaults such as `now()`, while the API boundary
  can expose UTC Unix milliseconds from Go `time.Time`.

Ownership/session foreign keys can be added with the auth/session migration once
the signup/session schema is designed. The first migration only needs to prove
migration plumbing and create the core expense storage.

## Goose CLI Verification

Use local Compose Postgres for verification. The proof should be equivalent to
running goose CLI `up` against `apps/api/migrations` and then checking the
resulting schema.

```fish
goose -dir apps/api/migrations postgres "$RECURRING_DEV_DATABASE_URL" up
```

`RECURRING_DEV_DATABASE_URL` is a local operator convenience for the committed
Compose database. Do not commit the expanded URL in tasks or docs. Production
migrations should not pass a DB password through command-line arguments.

## Criterion Status

`Local Compose Postgres is successfully migrated with the goose CLI`:
unresolved.

It is answered when `goose up` against local Compose applies the first
`expenses` migration and the migrated database contains the expected table and
constraints.
