# E2E Infra

`task test:e2e` wraps `apps/inertia/src/e2e/*.test.ts`
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

  subgraph webtestenv["src/e2e/webtestenv.ts"]
    sheets["Sheets service<br/>bun src/cmd.ts<br/>127.0.0.1:free-port"]
    api["API server<br/>go run ./cmd/api<br/>127.0.0.1:free-port"]
    oauth["OAuth2 mock server<br/>oauth2-mock-server<br/>localhost:free-port"]
    vite["Vite dev server<br/>bun vite dev<br/>localhost:free-port"]
    worker["Cloudflare Vite plugin<br/>Worker runtime<br/>src/worker.ts"]
    bunTest["Bun test<br/>src/e2e/*.test.ts"]
  end

  task --> compose
  task --> webtestenv

  api --> postgres
  api --> sheets
  api --> jaeger

  vite --> worker
  bunTest --> vite
  bunTest --> api
  bunTest --> jaeger
  worker --> api
  worker --> oauth
  worker --> jaeger
```

Boot order:

- `compose:up-d` starts Postgres and Jaeger.
- `webtestenv.ts` starts Sheets on a free localhost port, then starts the API
  with `go run ./cmd/api` on a free localhost port with a temporary config.
- `webtestenv.ts` picks a free `RECURRING_WEB_ORIGIN`, starts
  `oauth2-mock-server.ts`, then starts `bun vite dev`.
- `webtestenv.ts` passes `RECURRING_API_ORIGIN`, `RECURRING_WEB_ORIGIN`,
  `GOOGLE_AUTHORIZATION_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT`, and
  `GOOGLE_USERINFO_ENDPOINT` into Vite and Bun test.
- `vite.config.ts` injects those dynamic values as Worker vars when
  `RECURRING_CF_WORKER_TEST=1`; other Worker vars and secrets still come from
  `apps/inertia/wrangler.toml` and `.dev.vars.development`.
- After `/healthz` is ready on the Vite origin, `webtestenv.ts` starts
  `bun test src/e2e/`.
