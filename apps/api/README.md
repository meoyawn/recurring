# Recurring API (Go)

HTTP API served behind Caddy at `api.domain.com` in production. Local default: `http://127.0.0.1:8080`.

## Run

```bash
go run ./cmd/api
```

Optional: `RECURRING_API_ADDR=:3001`

## Layout

- `cmd/api` — `main`
- `internal/` — handlers, services, repositories (not importable by other modules)
- `migrations/` — SQL migrations (canonical)
- `gen/` — optional OpenAPI Generator **stubs** only (spec: `packages/openapi/spec/recurring.openapi.yaml`); wire routes by hand in `internal/`
