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
adapter and migration choices:

- Official Inertia client adapters are React, Vue, and Svelte, not Solid.
- Official Inertia server adapters are Laravel, Rails, Phoenix, and Django.
- There is no official Cloudflare Workers or Hono server adapter in the
  documented happy path.
- Inertia does not deploy to Cloudflare Workers by itself. A Worker can
  implement the protocol, but app routing, props, redirects, asset versioning,
  partial reloads, and static assets still need adapter code.
- Inertia SSR requires Node.js 22 or higher in the official deployment model.
  That affects component HTML pre-rendering only, not first-response page JSON.

Use Inertia on Workers only as a spike unless the team is willing to:

- Use React, Vue, or Svelte, or accept/build a Solid Inertia client adapter.
- Build a small Worker/Hono server adapter, or spike `@antennajs/adapter-hono`
  after code review.
- Move page routing and page data loading into Worker routes.
- Keep Inertia SSR disabled for the Worker deployment.

Stay with SolidStart if avoiding a frontend/router migration is more important
than adopting Inertia's server-routed page protocol.

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

## Worker Adapter Shape

A minimal Worker-owned Inertia adapter needs to switch response mode based on
the request headers.

```ts
const htmlSafeJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c")

type InertiaPage = {
  component: string
  props: Record<string, unknown>
  url: string
  version: string
}

const renderHtml = (page: InertiaPage) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script type="module" src="/assets/app.js" defer></script>
  </head>
  <body>
    <script data-page="app" type="application/json">${htmlSafeJson(page)}</script>
    <div id="app"></div>
  </body>
</html>`

const inertia = (request: Request, page: InertiaPage) => {
  if (request.headers.get("X-Inertia") === "true") {
    return Response.json(page, {
      headers: {
        "X-Inertia": "true",
        Vary: "X-Inertia",
      },
    })
  }

  return new Response(renderHtml(page), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Vary: "X-Inertia",
    },
  })
}
```

That helper follows the Inertia protocol shape for non-SSR first responses: page
JSON in `<script data-page="app" type="application/json">` and a root
`<div id="app"></div>` mount point.

That helper is only a sketch. A real adapter must also handle:

- Robust JSON escaping for inline page objects.
- Asset version checks using `X-Inertia-Version`.
- `409` plus `X-Inertia-Location` for asset mismatch and external redirects.
- `303` redirects after non-GET mutations.
- Shared props.
- Error props.
- Partial reload headers.
- CSRF/XSRF handling for unsafe methods.
- Static asset routing.

This adapter work is why Inertia is a bigger commitment than a SolidStart
configuration change.

## Adapter Status

There is no official Cloudflare Workers adapter in the current Inertia docs.
Inertia is adapter-driven: the official client adapters are React, Vue, and
Svelte; the official server adapters are Laravel, Rails, Phoenix, and Django.
The server-side setup docs remain Laravel-centered.

Inertia also does not support Workers "out of the box" as a deployment target in
the way SolidStart or Hono do. A Worker can run the protocol because the non-SSR
protocol is plain HTTP plus JSON, but some server adapter must still own the
protocol details.

Best current community candidate for this app:

- `@antennajs/adapter-hono`: Hono adapter for the Inertia protocol. It exposes
  middleware, `Inertia.render(ctx, component, props)`, root view customization,
  asset versioning, shared props, and lazy props. Because Hono runs on
  Cloudflare Workers and exposes bindings through `c.env`, this is the most
  directly Worker-shaped candidate.

Risks:

- `@antennajs/adapter-hono` is young and low-adoption. Treat it as source to
  inspect, not as proven infrastructure.
- It still needs verification against Inertia v3 protocol details used by this
  app: asset mismatch, external redirects, partial reloads, once props,
  validation errors, unsafe-method redirects, and no-SSR operation.
- Other emerging packages exist, such as `honertia`, but they are Inertia-style
  Hono frameworks rather than clearly documented drop-in Inertia protocol
  adapters for this app.

## Decision Points

Choose Worker-owned Inertia if the team wants Inertia as the app architecture:

- Server-owned routing.
- Page props loaded by Worker routes.
- Same-origin browser traffic.
- Recurring API called only by Worker code.
- Inertia navigation protocol instead of SolidStart routing.

Do not choose Worker-owned Inertia if the team wants to keep:

- SolidStart's current router and server-function model.
- Solid as the frontend framework without community adapter risk.
- A documented framework deployment path with minimal custom adapter code.
- Component HTML SSR on Cloudflare Workers.

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
- Hono supports Cloudflare Workers and exposes Worker bindings through `c.env`.
- Inertia SSR requires Node.js 22 or higher.
- Cloudflare Workers support standard Fetch APIs.
- Cloudflare Workers expose vars and secrets as bindings on the Worker `env`
  parameter; `cloudflare:workers` can expose `env` globally when needed.

Needs project spike:

- Complete Inertia v3 server adapter on Cloudflare Workers, or a reviewed
  `@antennajs/adapter-hono` integration.
- Solid Inertia client adapter suitable for this app.
- OAuth, cookies, and Recurring API behavior on preview and production Worker
  domains.
- Asset version mismatch behavior.
- Partial reload behavior.
- Unsafe-method redirects and CSRF behavior.

Do not treat Worker Inertia as a documented happy path. Treat it as a viable
runtime model with adapter risk.

## Recommended Spike

Build the smallest useful Worker-owned Inertia spike:

- Choose client adapter: React/Vue/Svelte for official support, or Solid only if
  community adapter risk is accepted.
- Start with `@antennajs/adapter-hono` if its source passes review; otherwise
  build the smallest Worker/Hono adapter locally.
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

Acceptance checks:

- First response includes correct page props.
- Client navigation requests JSON without full reload.
- Browser does not call the Recurring API directly.
- Asset version mismatch returns the expected Inertia reload behavior.
- Google OAuth callback sets cookies and redirects on a real Cloudflare preview.
- Session cookies work on the production custom domain.

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
- SolidStart config and Nitro presets:
  https://docs.solidjs.com/solid-start/reference/config/define-config
- Cloudflare Workers Node.js compatibility:
  https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Cloudflare Workers environment variables:
  https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare Workers Hono guide:
  https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/
- Hono Cloudflare Workers guide:
  https://www.honojs.com/docs/getting-started/cloudflare-workers
- `@antennajs/adapter-hono`:
  https://www.npmjs.com/package/@antennajs/adapter-hono
- `honertia`: https://socket.dev/npm/package/honertia
