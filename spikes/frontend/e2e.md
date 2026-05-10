# Frontend E2E Service Boot

Status: revised

## Success Criteria

- Frontend Miniflare tests run through `apps/api/cmd/webtestenv`.
- The wrapper boots `apps/api` and `apps/sheets` with test-appropriate configs.
- The wrapper shuts down both `apps/api` and `apps/sheets` on exit, including
  success, failure, and interrupted runs.
- The frontend Miniflare task depends on `compose:up-d`.
- `task check` passes at the end.

## Observations

- `apps/inertia/Taskfile.yaml` runs Miniflare tests through:

  ```yaml
  test:miniflare:
    run: once
    deps:
      - compose:up-d
      - build
    cmd: go -C ../api run ./cmd/webtestenv --cwd ../inertia -- bun vitest run --config vitest.miniflare.config.ts
  ```

- `apps/api/internal/app/server.go` exposes `app.StartWithConfig(ctx, cfg)`, and
  `apps/api/internal/apitest/api_test.go` already uses it with `localhost:0` for
  test-owned API ports.
- `app.StartWithConfig` runs migrations before opening the API pool, so a
  wrapper does not need a separate migration step when using API config.
- `apps/api/config/dev.yaml` points API at local compose Postgres on port 5432.
- `apps/sheets/src/cmd.ts` is bootable with `bun src/cmd.ts` and exposes
  `/healthz`.

## Decision

Use one test environment wrapper around the frontend Miniflare command.

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
  -> run wrapped frontend test command with RECURRING_API_ORIGIN=http://<api-addr>
  -> terminate wrapped command and Sheets on exit
  -> shut API down
```

## Criteria Status

- Wrapper around the frontend Miniflare command in `webtestenv`: answered.
- Wrapper boots API and Sheets with test configs: answered at design level.
- Wrapper shuts down API and Sheets on exit: answered at design level.
- Add `compose:up-d` dep: answered.
- Miniflare tests pass: unresolved until implementation is re-verified.
- `task check` passes: unresolved until implementation is re-verified.
