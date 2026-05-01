# Recurring API (Go)

HTTP API served behind Caddy in production. Local development listens on the Unix socket from `config/dev.yaml`.

## Run

```bash
RECURRING_CONFIG=config/dev.yaml go run ./cmd/api
```

Health check: `GET /healthz`.

## Layout

- `cmd/api` — `main`
- `internal/` — handlers, services, repositories (not importable by other modules)
- `migrations/` — SQL migrations (canonical)
- `gen/` — optional OpenAPI Generator **stubs** only (spec: `packages/openapi/spec/recurring.openapi.yaml`); wire routes by hand in `internal/`
