# Inertia.js On Cloudflare Workers

## Goal

Decide whether Inertia.js is a practical Cloudflare Workers deployment model for
this app.

Required behavior:

- Browser talks to one web origin.
- Worker runs request-scoped page logic.
- Worker calls the API declared by
  `packages/openapi/spec/recurring.responsible.ts`.
- First HTML response includes an Inertia root element and a JSON-encoded
  Inertia page object whose `props` contain initial page data.
- Later navigation fetches page JSON without a full reload.
- Google OAuth start and callback routes run on Cloudflare Workers.

## Verdict

Inertia's non-SSR protocol fits Cloudflare Workers.

That means a Worker can return an HTML shell with an embedded Inertia page
object on the first request, then return JSON page objects for later Inertia
navigation requests.

This is not blocked by the Cloudflare Workers runtime. The real blockers are
adapter maturity and migration choices:

- Official Inertia client adapters are React, Vue, and Svelte, not Solid.
- The current app preference is still to keep Solid and use the community
  `inertia-adapter-solid` package, accepting fork maintenance and upstream
  contribution work as an owned project cost.
- Official Inertia server adapters are Laravel, Rails, Phoenix, and Django.
- Inertia does not document a first-party Cloudflare Workers server adapter in
  its official server setup path.
- Hono now has an experimental `@hono/inertia` middleware package in the
  `honojs/middleware` repository. This is the best Workers-shaped adapter
  candidate because Hono runs directly on Cloudflare Workers.
- Inertia still does not deploy to Cloudflare Workers by itself. Hono owns the
  Worker routing layer, `@hono/inertia` owns the Inertia response protocol, and
  the app still owns page data, redirects, mutations, static assets, and
  deployment wiring.
- Inertia SSR requires Node.js 22 or higher in the official deployment model.
  That affects component HTML pre-rendering only, not first-response page JSON.
- The local migration cost looks acceptable because `apps/web` is currently a
  small SolidStart alpha surface, while `apps/sheets` is already planned as a
  Bun + Hono service. A Hono-owned web app gives both apps similar request,
  routing, fetch, and observability boundaries.

Use Inertia on Workers only as a spike unless the team is willing to:

- Use the freshest `inertia-adapter-solid` beta and accept maintaining a fork or
  contributing fixes upstream.
- Spike experimental `@hono/inertia` and verify the protocol edges needed by
  this app.
- Move page routing and page data loading into Worker routes.
- Keep Inertia SSR disabled for the Worker deployment.

See `progress.md` for cross-spike progress.

## Terms

This document uses these terms consistently:

- `Inertia page object`: JSON object returned by the server. It includes
  `component`, `props`, `url`, `version`, and optional protocol fields.
- `Initial page data`: the `props` inside the first Inertia page object, which
  is JSON-encoded into the first HTML response.
- `Non-SSR Inertia`: server returns an HTML shell plus page object JSON; browser
  renders the JavaScript page component.
- `Inertia SSR`: server pre-renders the JavaScript page component to HTML before
  sending the response.

Only non-SSR Inertia is a good fit for a simple Cloudflare Workers deployment.

## Runtime Model

Non-SSR Inertia matches the desired Worker shape:

- Worker receives a browser request.
- Worker reads cookies, headers, and route params.
- Worker calls the Recurring API server-side when page data is needed.
- Worker creates an Inertia page object.
- First visit returns HTML containing an Inertia root element and a
  `<script type="application/json" data-page="app">` element containing the page
  object.
- Browser mounts the JavaScript app from that page object.
- Later Inertia visits send `X-Inertia: true`.
- Worker returns JSON page objects with `X-Inertia: true` and `Vary: X-Inertia`.

No Node.js process is required for that flow.

Node.js is required only for Inertia SSR in the official model. SSR is a
different flow:

- Server sends the page object to an SSR renderer.
- SSR renderer imports the JavaScript page component.
- SSR renderer returns rendered component HTML.
- Browser hydrates that component HTML.

Cloudflare Workers can do the non-SSR flow. Treat Inertia SSR inside a Worker as
unproven and out of scope for this app's Worker spike.

## API Boundary

The browser should not call the Recurring API directly.

The intended shape is:

- Browser calls only the web origin.
- Worker routes produce page data.
- Worker routes call the API declared by
  `packages/openapi/spec/recurring.responsible.ts`.
- Worker returns Inertia page objects or redirects to the browser.

## Google Auth On Workers

Google OAuth does not require Inertia responses. It can stay as plain Worker or
Hono routes:

- `/auth/google/start` redirects to Google and sets `googleOAuthState`.
- `/auth/google/callback` exchanges the code, calls the Recurring API, sets
  `sessionID`, and redirects into the app.
- `SameSite=Lax` cookies fit the top-level OAuth redirect flow.

`apps/web/src/lib/googleAuth.ts` is already close to Worker-compatible:

- It accepts standard `Request`.
- It returns standard `Response`.
- It uses `fetch`, `Headers`, `URL`, `URLSearchParams`, and Web Crypto.
- It stores OAuth state and session IDs in HTTP-only cookies.

Cloudflare-specific concerns:

- `GOOGLE_CLIENT_SECRET` must be a Cloudflare secret binding, not a checked-in
  variable.
- `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, and Recurring API connection
  settings should be Cloudflare Worker bindings. Use vars for non-sensitive
  values and secrets for sensitive values.
- Current code reads `process.env`. For Worker deployment, prefer passing typed
  Cloudflare `env` bindings into auth helpers, or importing `env` from
  `cloudflare:workers` where request-independent access is needed.
- Do not require `nodejs_compat` just to read app configuration.
- `GOOGLE_REDIRECT_URI` should be the production custom domain callback, not a
  workers.dev preview URL, unless that preview URL is registered in Google
  OAuth.

## Hono Adapter Shape

The preferred Worker adapter candidate is `@hono/inertia`.

```ts
import { Hono } from "hono"
import { inertia, serializePage, type RootView } from "@hono/inertia"

const rootView: RootView = page => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script type="module" src="/src/client.tsx"></script>
  </head>
  <body>
    <script data-page="app" type="application/json">${serializePage(page)}</script>
    <div id="app"></div>
  </body>
</html>`

const app = new Hono()

app.use(inertia({ version: "1", rootView }))

app.get("/", c => c.render("Home", { message: "Hello, Inertia" }))
```

`@hono/inertia` sets `c.render(component, props)` and switches response mode
from request headers:

- normal document request: full HTML from `rootView(page, c)`
- `X-Inertia` request: JSON page object with `X-Inertia: true`
- `Accept: application/json`: props JSON for the same route
- stale `X-Inertia-Version` on `GET`: `409` with `X-Inertia-Location`

It also provides `serializePage(page)` for safe `<script
type="application/json">` embedding and a Vite plugin that generates page-name
types for `c.render()`.

The middleware removes the need to write the basic response-mode adapter. It
does not remove the need to verify app-level protocol behavior:

- Root HTML and static asset production wiring.
- `303` redirects after non-GET mutations.
- External redirects.
- Shared props and error props.
- Partial reload headers and lazy prop evaluation.
- CSRF/XSRF handling for unsafe methods.
- Validation error transport.
- No-SSR operation with the chosen official client adapter.

The source for `@hono/inertia` 0.2.0 shows the core response switching and asset
version mismatch behavior. Treat broader protocol claims as things to test in
the project spike, not assumptions.

## Adapter Status

There is no official Cloudflare Workers adapter in the current Inertia docs.
Inertia is adapter-driven: the official client adapters are React, Vue, and
Svelte; the official server adapters are Laravel, Rails, Phoenix, and Django.
The server-side setup docs remain Laravel-centered.

There is now a Hono-maintained middleware package:

- `@hono/inertia` 0.2.0, published April 28, 2026.
- It lives in the `honojs/middleware` monorepo and is marked experimental.
- It exposes `inertia()`, `serializePage()`, `RootView`, `PageObject`, and a
  `@hono/inertia/vite` page-generation plugin.
- It has peer dependencies on `hono >=4.0.0` and optional `vite >=5.0.0`.
- It fits Cloudflare Workers because the deployment target is ordinary Hono on
  Workers, not a Node SSR service.

This materially improves the Inertia-on-Workers story. The app no longer needs
to start by building its own response-mode adapter or relying on
a separate community Hono adapter.

Remaining risks:

- `@hono/inertia` is new and explicitly experimental.
- It is Hono-maintained, not an official Inertia server adapter.
- It still needs verification against the exact Inertia v3 behavior used by this
  app: asset mismatch, external redirects, partial reloads, once props,
  validation errors, unsafe-method redirects, and no-SSR operation.
- Official client support is still React, Vue, and Svelte. Solid still requires
  community adapter risk.

## Solid Adapter Choice

The current preferred client path is Solid with `inertia-adapter-solid`, not a
switch to React, Vue, or Svelte.

Use the freshest published beta:

- `inertia-adapter-solid@1.0.0-beta.3`, published April 18, 2026.
- Do not start from stable `0.3.1` for this spike.
- Stable `0.3.1` depends on `@inertiajs/core ^1.3.0`.
- Beta `1.0.0-beta.3` depends on `@inertiajs/core ^2.2.11`.
- Current Inertia docs are v3, and current `@inertiajs/core` is `3.0.3`, so
  the spike must verify whether beta behavior is sufficient or whether the fork
  needs a core-version update.

This changes the risk profile. The Solid adapter is still community software,
but the team is willing to maintain a fork and contribute upstream. Treat that
as a known dependency ownership cost, not an automatic blocker.

The Solid adapter spike must verify:

- `createInertiaApp()` boots from the `@hono/inertia` root page payload.
- `Link` and programmatic visits produce correct Inertia request headers.
- Router events are available for observability hooks, or can be wrapped through
  `@inertiajs/core`.
- Forms, validation errors, redirects, partial reloads, and asset mismatch
  behavior match the app's needed subset.
- SSR stays disabled for Worker deployment.

## Inertia SSR Elsewhere

Use Inertia SSR elsewhere only if server-rendered component HTML matters:

- Deploy on a Node/Bun server platform.
- Or split a separate Node SSR service from the Worker.

That adds infrastructure and is not the simple Workers deployment model.

## Evidence Level

Known-supported:

- Inertia defines a protocol with HTML first responses and JSON follow-up
  responses.
- Inertia official client support is React, Vue, and Svelte.
- Inertia server setup is adapter-driven and Laravel-centered in the docs.
- Inertia official server adapters do not include Cloudflare Workers or Hono.
- `@hono/inertia` exists as an experimental Hono middleware package and provides
  core Inertia response-mode handling for Hono routes.
- `inertia-adapter-solid@1.0.0-beta.3` exists and uses the newer
  `@inertiajs/core` v2 line compared with stable `0.3.1`.
- Hono supports Cloudflare Workers and exposes Worker bindings through `c.env`.
- Inertia SSR requires Node.js 22 or higher.
- Cloudflare Workers support standard Fetch APIs.
- Cloudflare Workers expose vars and secrets as bindings on the Worker `env`
  parameter; `cloudflare:workers` can expose `env` globally when needed.

Needs project spike:

- `@hono/inertia` integration on Cloudflare Workers.
- `inertia-adapter-solid@1.0.0-beta.3` suitability for this app, including any
  fork required for Inertia v3/core compatibility.
- OAuth, cookies, and Recurring API behavior on preview and production Worker
  domains.
- Asset version mismatch behavior.
- Partial reload behavior.
- Unsafe-method redirects and CSRF behavior.

Do not treat Worker Inertia as a documented Inertia happy path yet. Treat it as
a viable Hono runtime model with a newly available experimental adapter.

## Recommended Spike

Build the smallest useful Worker-owned Inertia spike:

- Use `inertia-adapter-solid@1.0.0-beta.3` as the client adapter.
- Start with `@hono/inertia` and keep SSR disabled.
- Serve Vite-built client assets from the Worker deployment.
- Port one authenticated page route into a Worker route handler.
- Call the API declared by `packages/openapi/spec/recurring.responsible.ts` from
  that Worker route.
- Return initial HTML with the conventional Inertia root element and
  JSON-encoded page object.
- Verify later navigation returns JSON with `X-Inertia: true`.
- Keep `/auth/google/start` and `/auth/google/callback` as normal redirect
  routes.
- Pass typed Cloudflare Worker `env` bindings into Google auth and API helpers.
- Move data reads and mutations behind Worker-owned Inertia page props or form
  actions.
- Keep Inertia SSR disabled.
- Keep any Solid adapter fork small and upstreamable.

Acceptance checks:

- First response includes correct page props.
- Client navigation requests JSON without full reload.
- Solid `Link` or programmatic visits send the expected Inertia headers.
- Browser does not call the Recurring API directly.
- Asset version mismatch returns the expected Inertia reload behavior.
- Google OAuth callback sets cookies and redirects on a real Cloudflare preview.
- Session cookies work on the production custom domain.
- Partial reload requests evaluate and return only the intended prop keys, or
  the app explicitly defers partial reload support.

## References

- Inertia v3 introduction: https://inertiajs.com/docs/v3/getting-started
- Inertia server-side setup:
  https://inertiajs.com/docs/v3/installation/server-side-setup
- Inertia client-side setup:
  https://inertiajs.com/docs/v3/installation/client-side-setup
- Inertia protocol: https://inertiajs.com/docs/v3/core-concepts/the-protocol
- Inertia SSR: https://inertiajs.com/docs/v3/advanced/server-side-rendering
- Inertia authentication: https://inertiajs.com/docs/v3/security/authentication
- Inertia redirects: https://inertiajs.com/docs/v3/the-basics/redirects
- Inertia CSRF: https://inertiajs.com/docs/v3/security/csrf-protection
- Cloudflare Workers Node.js compatibility:
  https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare Workers environment variables:
  https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare Workers Hono guide:
  https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/
- Hono Cloudflare Workers guide:
  https://www.honojs.com/docs/getting-started/cloudflare-workers
- `@hono/inertia`: https://github.com/honojs/middleware/tree/main/packages/inertia
- `@hono/inertia` npm: https://www.npmjs.com/package/@hono/inertia
- `inertia-adapter-solid`: https://github.com/iksaku/inertia-adapter-solid
- `inertia-adapter-solid` npm:
  https://www.npmjs.com/package/inertia-adapter-solid
