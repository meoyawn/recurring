# `cf-worker.test.ts` Infra

`task test:e2e` wraps `apps/inertia/src/e2e/cf-worker.test.ts`
in short-lived services. The test process talks to the Worker through the Vite
dev HTTP origin, while the Worker gets Cloudflare-style bindings from
`wrangler.toml`, `.dev.vars.development`, and the wrapper's dynamic env vars.

```mermaid
flowchart LR
  task["task test:e2e"]

  subgraph compose["Docker Compose"]
    postgres[("Postgres<br/>recurring-postgres-1<br/>localhost:5432")]
    jaeger["Jaeger<br/>OTLP 4317/4318<br/>query 127.0.0.1:16686"]
  end

  subgraph webtestenv["apps/api/cmd/webtestenv"]
    sheets["Sheets service<br/>bun src/cmd.ts<br/>127.0.0.1:free-port"]
    api["API server<br/>Go in-process<br/>127.0.0.1:free-port"]
  end

  subgraph runner["src/e2e/cf-worker-test-runner.ts"]
    oauth["OAuth2 mock server<br/>oauth2-mock-server<br/>localhost:free-port"]
    vite["Vite dev server<br/>bun vite dev<br/>localhost:free-port"]
    worker["Cloudflare Vite plugin<br/>Worker runtime<br/>src/worker.ts"]
    vitest["Vitest<br/>cf-worker.test.ts"]
  end

  task --> compose
  task --> webtestenv
  task --> runner

  api --> postgres
  api --> sheets
  api --> jaeger

  vite --> worker
  vitest --> vite
  vitest --> api
  vitest --> jaeger
  worker --> api
  worker --> oauth
  worker --> jaeger
```

Boot order:

- `compose:up-d` starts Postgres and Jaeger.
- `webtestenv` starts Sheets on a free localhost port, then starts the API on a
  free localhost port and exports `RECURRING_API_ORIGIN` to the wrapped command.
- `cf-worker-test-runner.ts` picks a free `RECURRING_WEB_ORIGIN`, starts
  `oauth2-mock-server.ts`, then starts `bun vite dev`.
- The runner passes `RECURRING_API_ORIGIN`, `RECURRING_WEB_ORIGIN`,
  `GOOGLE_AUTHORIZATION_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT`, and
  `GOOGLE_USERINFO_ENDPOINT` into Vite/Vitest.
- `vite.config.ts` injects those dynamic values as Worker vars when
  `RECURRING_CF_WORKER_TEST=1`; other Worker vars and secrets still come from
  `apps/inertia/wrangler.toml` and `.dev.vars.development`.
- After `/healthz` is ready on the Vite origin, the runner starts Vitest for
  `src/e2e/**/*.test.ts`.
