# Frontend E2E Service Boot

## Success Criteria

- `apps/web` `test:miniflare` keeps the current Vitest command shape
  `bun vitest run --config vitest.miniflare.config.ts`, but wraps it in
  `apps/api/cmd/webtestenv`.
- The wrapper boots `apps/api` and `apps/sheets` with test-appropriate configs.
- The wrapper shuts down both `apps/api` and `apps/sheets` on exit, including
  success, failure, and interrupted runs.
- `test:miniflare` adds `compose:up-d` to its deps.
- `task check` passes at the end.

## Observations

- `apps/web/Taskfile.yaml` currently runs Miniflare tests with:

  ```yaml
  test:miniflare:
    run: once
    deps:
      - build
    cmd: bun vitest run --config vitest.miniflare.config.ts
  ```

- `apps/web/vitest.miniflare.config.ts` currently reads bindings from
  `apps/web/wrangler.toml`, where `RECURRING_API_ORIGIN` is fixed to
  `http://localhost:8080`.
- `apps/web/src/miniflare/cf-worker.test.ts` already verifies that Miniflare can
  read Wrangler bindings and can call the built SolidStart Worker `/healthz`.
- `apps/web/src/lib/api.test.ts` is not included by `test:miniflare`; it is run
  by `test:unit`. The Miniflare include is `src/miniflare/**/*.test.ts`.
- `compose:up-d` currently starts only Postgres, through
  `compose/docker-compose.yml`.
- `apps/api/internal/app/server.go` exposes `app.StartWithConfig(ctx, cfg)`, and
  `apps/api/internal/apitest/api_test.go` already uses it with `localhost:0` for
  test-owned API ports.
- `app.StartWithConfig` runs migrations before opening the API pool, so a
  wrapper does not need a separate migration step when using API config.
- `apps/api/config/dev.yaml` points API at local compose Postgres on port 5432.
- `apps/api/internal/config.Config` currently only contains `api` and `db`
  sections. There is no Sheets origin field yet.
- `apps/sheets/src/cmd.ts` is trivially bootable with `bun src/cmd.ts`, and
  exports a Hono app with `/healthz`.
- `apps/sheets/Taskfile.yaml` uses `bun --hot src/cmd.ts` for dev. That is a
  foreground development command, not a good e2e child process because the
  wrapper should own readiness and shutdown.
- `packages/openapi/Taskfile.yaml` now generates the Sheets OpenAPI YAML at
  `apps/sheets/src/sheets.openapi.yaml`, and generates a Go Sheets client under
  `apps/api/internal/gen/sheets/`.

## Decision

Use one test environment wrapper around the existing Miniflare command.

The wrapper should live under `apps/api`, because it can import internal API
packages and start API in-process with `app.StartWithConfig`. This avoids
writing temporary API config files and avoids starting `task dev:api`.

Recommended wrapper shape:

```text
apps/api/cmd/webtestenv
  -> load apps/api/config/dev.yaml
  -> choose a local Sheets port
  -> spawn apps/sheets with bun src/cmd.ts and test env
  -> wait for Sheets /healthz
  -> build API config from dev config
       api.listener = tcp localhost:0
       db = compose Postgres config
       sheets.origin = http://localhost:<sheets-port>
  -> start API in-process
  -> wait for API /healthz
  -> run wrapped command with RECURRING_API_ORIGIN=http://<api-addr>
  -> terminate wrapped command and Sheets on exit
  -> shut API down
```

Task shape:

```yaml
test:miniflare:
  run: once
  deps:
    - compose:up-d
    - build
  cmd: >-
    go -C ../api run ./cmd/webtestenv --cwd ../web -- bun vitest run --config
    vitest.miniflare.config.ts
```

Because `apps/web/Taskfile.yaml` is an included Taskfile, it should include
`compose` directly if `test:miniflare` depends on `compose:up-d` there.

## Config Flow

Use dynamic service origins for e2e:

- Sheets origin: chosen by wrapper and injected into API config.
- API origin: API listener chosen with `localhost:0`, then injected into the
  wrapped web test command as `RECURRING_API_ORIGIN`.
- Miniflare binding: `vitest.miniflare.config.ts` must prefer
  `process.env.RECURRING_API_ORIGIN` over the static value in `wrangler.toml`.

The Miniflare config should keep `wrangler.configPath` for the normal binding
shape, but override the dynamic var when the wrapper provides it.

## Readiness And Cleanup

The wrapper should own process lifecycle:

- Start Sheets before API, because API depends on Sheets.
- Poll `GET /healthz` for Sheets before starting API.
- Poll `GET /healthz` for API before starting Vitest.
- Stream child stdout/stderr with clear prefixes.
- On Vitest success or failure, shut down API and terminate Sheets.
- Return the wrapped command exit code.
- Use timeouts for startup and shutdown so failed boots do not hang agents.

Do not use `task dev:api`, `task dev:sheets`, or long-running dev servers in the
e2e path.

## Test Data

Initial e2e can avoid scoped databases by following the API test style:

- generate random users, emails, names, and test IDs
- avoid assertions that require an empty database
- avoid fixed fixture IDs

Scoped database or schema cleanup can be added later when tests need empty-list
assertions, count assertions, uniqueness conflict cases, or deletion workflows.

## Observability Fit

This boot model is compatible with later tracing:

- Compose can later own Jaeger or OpenObserve.
- The wrapper can inject `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `DEPLOYMENT_ENVIRONMENT=test`, and `APP_TEST_RUN_ID`.
- API should use an observable Sheets client wrapper around
  `apps/api/internal/gen/sheets/`.
- Sheets should use Hono OpenTelemetry middleware and request IDs later.

Trace backend should stay outside the per-run wrapper. It is infrastructure like
Postgres, so `compose:up-d` is the right owner.

## Unresolved

- API config needs a Sheets origin field before API can call Sheets through the
  generated client.
- Sheets needs a clear test port contract. The wrapper should either pass an
  explicit port env var supported by Bun/Hono, or the Sheets entrypoint should
  grow a tiny config/env read for `localhost:<port>`.
- `vitest.miniflare.config.ts` needs a dynamic binding override for
  `RECURRING_API_ORIGIN`.
- `test:miniflare` currently only includes `src/miniflare/**/*.test.ts`; real
  backend-facing web e2e should live there or the include pattern must change.
- Existing Taskfile caching may skip `test:miniflare` when sources are
  unchanged. That is current behavior, but agent loops may need `task --force`
  or a future uncached e2e task.

## Criteria Status

- Wrapper around current `test:miniflare` command in `webtestenv`: answered.
- Wrapper boots API and Sheets with test configs: answered at design level;
  blocked on API Sheets config and Sheets port contract.
- Wrapper shuts down API and Sheets on exit: answered at design level.
- Add `compose:up-d` dep: answered.
- `test:miniflare` passes: unresolved until implementation.
- `task check` passes: unresolved until implementation.
