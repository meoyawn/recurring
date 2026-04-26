# Recurring web (SolidStart)

Bun is the package manager for this workspace. Scripts use `bun run`.

## Environment

- `RECURRING_API_ORIGIN` — upstream Go API base URL (no trailing slash). Used by the Vite dev proxy and Nitro production `routeRules` proxy for `/api/backend/**` → upstream `/**`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth client credentials used by `/auth/google/start` and `/auth/google/callback`.
- `GOOGLE_REDIRECT_URI` — optional explicit callback URL. Defaults to `<request-origin>/auth/google/callback`.

Defaults to `http://127.0.0.1:8080` when unset.

Copy `.env.example` to `.env` for local overrides.

## No browser CORS

The UI calls **`/api/backend/...`** on the same host. The SolidStart server (Nitro in production, Vite in dev) forwards those requests to `RECURRING_API_ORIGIN`. The browser never talks to `api.domain.com` directly.

## OpenAPI client

After `task openapi:gen:client` (or `bun run openapi:client` from the repo root), import generated types/clients from `gen/` (see `packages/openapi`).
