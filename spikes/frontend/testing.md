# Frontend Testing On Cloudflare Workers

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

Use a built `dist/` artifact only when the test must exercise generated
SolidStart/Nitro output or static assets.

`@cloudflare/vitest-pool-workers` does not run an arbitrary Vite app like
`vite dev`. It runs Vitest test files inside local `workerd` processes through
Miniflare. Vite is used for transforms and module loading, but app framework
servers are not automatically booted from `vite.config.ts`.

For `apps/web`, this matters because the current Vite config is framework
orchestration:

```ts
plugins: [
  solidStart({
    ssr: false,
  }),
  nitro(),
]
```

That config describes SolidStart/Nitro build and dev behavior. The Workers
Vitest pool can test Worker-compatible source modules, but it does not by itself
serve the SolidStart app, run Nitro routing, or expose emitted client assets.

## Tool Roles

Use these tools for different jobs:

- `vitest` with `@cloudflare/vitest-pool-workers`: source-level Worker tests.
- `wrangler dev`: local Worker dev server.
- Cloudflare Vite plugin: Vite-centered Worker app dev and preview, if this app
  moves to that integration.
- `vite build` or SolidStart/Nitro build: produce final app output.
- Browser tests: verify real DOM, navigation, OAuth callback pages, and assets.

`wrangler dev` and the Cloudflare Vite plugin also use Miniflare under the hood.
The important distinction is entrypoint:

- `wrangler dev` starts an app server.
- `vite dev` with Cloudflare plugin starts a Vite-integrated app server.
- `@cloudflare/vitest-pool-workers` starts Workers to execute test files.

## When Build Is Not Required

Do not build `dist/` first when testing source modules that can run directly in
the Workers runtime.

Good targets:

- Worker or Hono route handlers.
- Inertia response helper.
- Same-origin proxy logic.
- Google OAuth start and callback helpers.
- Cookie parsing and `Set-Cookie` behavior.
- Redirect status and headers.
- Request-scoped calls to `RECURRING_API_ORIGIN`.

Example shape:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker.ts",
      miniflare: {
        bindings: {
          RECURRING_API_ORIGIN: "https://api.example.test",
        },
      },
    }),
  ],
})
```

Tests can call the Worker through `SELF`:

```ts
import { SELF } from "cloudflare:test"
import { expect, test } from "vitest"

test("first visit returns html", async () => {
  const response = await SELF.fetch("https://app.example.test/")

  expect(response.status).toBe(200)
  expect(response.headers.get("Content-Type")).toContain("text/html")
  expect(response.headers.get("Vary")).toContain("X-Inertia")
})
```

## When Build Is Required

Build first when the thing under test exists only after the framework build.

Build is required for:

- Final SolidStart/Nitro generated Worker entrypoint.
- Static client assets emitted by Vite.
- Asset manifest behavior.
- `ASSETS` binding behavior backed by real build output.
- Exact deploy artifact behavior.
- Auxiliary Workers with TypeScript entrypoints.

For asset-backed tests, point the test binding at built files:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { buildPagesASSETSBinding } from "@cloudflare/vitest-pool-workers/config"
import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const assetsPath = path.join(__dirname, "dist/client")

      return {
        miniflare: {
          serviceBindings: {
            ASSETS: await buildPagesASSETSBinding(assetsPath),
          },
        },
      }
    }),
  ],
})
```

Use the actual output directory produced by the app build. Do not assume
`dist/client` until SolidStart/Nitro output is verified.

## Worker Test Model

The Workers Vitest pool works differently from normal Node Vitest:

- Vitest config and global setup run in Node.
- Test files run inside local `workerd`.
- Miniflare provides bindings and local resource simulations.
- Tests can import `cloudflare:test` helpers.
- Tests can import `env` from `cloudflare:workers`.
- Storage can be isolated per test file.
- Watch mode can reuse Workers and module caches.

Default isolation is usually the right starting point. Consider
`singleWorker: true` only when many tiny test files make process startup cost
noticeable.

Important caveat:

- The pool may enable Node compatibility flags so Vitest can run inside Workers.
  Tests can pass while production deploy fails if app code accidentally imports
  Node-only APIs and production config does not enable `nodejs_compat`.

For Worker-targeted code, keep dependencies compatible with Workers even when
tests happen to tolerate more Node behavior.

## Recommended Coverage

For a Worker/Inertia spike, test source first:

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

## Current Web App Implication

`apps/web` should not start by testing the whole SolidStart app through
`@cloudflare/vitest-pool-workers`.

Start by extracting Worker-compatible logic into modules with standard
`Request`, `Response`, `fetch`, and `env` inputs. Test those modules in the
Workers Vitest pool.

Use a build-first test only after the deployment target is clear:

- SolidStart/Nitro-generated Worker.
- Worker/Hono app serving Vite-built client assets.
- Cloudflare Vite plugin app.

This keeps fast tests focused on runtime behavior and reserves slower artifact
tests for deploy-shape verification.

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
