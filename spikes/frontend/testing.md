# Frontend Testing On Cloudflare Workers

Status: revised

## Goal

Define how to test the frontend Worker deployment shape for this app.

Desired coverage:

- Worker route logic runs in a Workers-compatible runtime.
- Cloudflare bindings are available in tests.
- Same-origin browser behavior can be verified.
- Go API calls can be mocked or pointed at a test upstream.
- OAuth redirects and cookies can be tested without a browser.
- Built asset behavior can be tested when needed.

## Current Finding

Use `@cloudflare/vitest-pool-workers` for Worker source tests.

Use a built `dist/` artifact only when the test must exercise generated Worker
output or static assets.

The Workers Vitest pool runs test files inside local `workerd` processes through
Miniflare. Vite is used for transforms and module loading, but app framework
servers are not automatically booted from `vite.config.ts`.

## Tool Roles

Use these tools for different jobs:

- `vitest` with `@cloudflare/vitest-pool-workers`: source-level Worker tests.
- `wrangler dev`: local Worker dev server when needed.
- Cloudflare Vite plugin: Vite-centered Worker app dev and preview.
- `vite build`: produce final app output.
- Browser tests: verify real DOM, navigation, OAuth callback pages, and assets.

## Recommended Coverage

For the Worker/Inertia app, test source first:

- First request without `X-Inertia` returns HTML.
- HTML response embeds safe page JSON.
- Inertia request with `X-Inertia: true` returns JSON.
- JSON response includes `X-Inertia: true`.
- All Inertia responses include `Vary: X-Inertia`.
- Asset version mismatch returns `409` plus `X-Inertia-Location`.
- Non-GET mutation redirects use `303`.
- Browser-facing routes never expose the Go API origin.
- Worker calls the configured upstream API server-side.

For Google OAuth:

- Start route redirects to Google.
- Start route sets `googleOAuthState`.
- Callback route rejects invalid state.
- Callback route exchanges code through mocked fetch.
- Callback route sets `sessionID`.
- Callback route redirects into the app.
- Cookies use expected `HttpOnly`, `Secure`, `SameSite`, and `Path` attributes.

For built output:

- Static assets are served from expected paths.
- Client entry script path in HTML exists in build output.
- SPA fallback behavior works if configured.
- Production custom-domain cookie behavior is verified on a real Cloudflare
  preview or deployment.

## References

- Cloudflare Workers Vitest integration:
  https://developers.cloudflare.com/workers/testing/vitest-integration/
- Cloudflare Workers Vitest configuration:
  https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/
- Cloudflare Workers Vitest isolation:
  https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/
- Cloudflare Workers test APIs:
  https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/
- Cloudflare Workers local development:
  https://developers.cloudflare.com/workers/local-development/
- Cloudflare Workers Vite plugin:
  https://developers.cloudflare.com/workers/vite-plugin/
