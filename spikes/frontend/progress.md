# Frontend Spike Progress

## Comparison Update

As of April 29, 2026, the comparison between `solid.md` and `inertia.md` puts
SolidStart back as the conservative default for the current app, while keeping
Worker-owned Inertia as a serious spike candidate.

Both paths satisfy the core runtime shape:

- Browser talks to one web origin.
- Worker runs request-scoped logic.
- Worker calls the API declared by
  `packages/openapi/spec/recurring.responsible.ts`.
- Browser does not call the Recurring API directly.
- Google OAuth start and callback routes run on the Worker.
- Interactive app DOM is rendered in the browser.
- Component HTML SSR is not required for the app body.

The SolidStart path is safer for `apps/web` because it preserves the current
framework and routing model:

- Keep `ssr: true`.
- Keep the router root, layouts, auth wrappers, and data-owning route modules
  visible to the server.
- Use per-route server wrappers with `query()` / `createAsync()` when first
  response data must be serialized.
- Move browser-only UI into `clientOnly` child components.
- Add a server-only Recurring API facade for calls from SolidStart queries,
  server functions, and route API handlers.

The Inertia path is cleaner as an app protocol, but has higher ownership cost:

- Use Hono as the web routing/runtime layer.
- Use experimental `@hono/inertia` for the server-side Inertia response
  protocol.
- Keep Solid as the component layer by starting from
  `inertia-adapter-solid@1.0.0-beta.3`.
- Accept maintaining a fork and contributing upstream if the Solid adapter needs
  protocol or Inertia core compatibility fixes.
- Keep Inertia SSR disabled for Cloudflare Workers.

Current tradeoff:

- SolidStart is the stronger default if preserving the existing app shape,
  SolidStart router, server functions, and Solid-native support matters most.
- Inertia is the stronger fit if the required product protocol is explicitly
  Inertia-style first-response page props plus later JSON page visits, and a
  frontend/router migration is acceptable.
- SolidStart can approximate the protocol with per-route wrappers, but it does
  not have Inertia's named page-object envelope or visit protocol.
- `@hono/inertia` is still experimental, so Inertia's advantage is protocol
  clarity, not zero-risk maturity.
- `inertia-adapter-solid` is still community-maintained, but fork ownership is
  acceptable for this project.
- Hono alignment matters because `apps/sheets` is already planned as Bun + Hono;
  the web app can share request IDs, context helpers, structured logging,
  backend fetch helpers, and trace propagation patterns with it.

## Decision Points

Choose SolidStart if the team wants the lowest-risk path from the current
`apps/web` codebase:

- Keep SolidStart's router and server-function model.
- Keep Solid as the frontend framework without community adapter or fork risk.
- Keep `apps/web` on `ssr: true`.
- Use SolidStart route-data serialization for first-response data.
- Accept per-route wrapper ceremony for authenticated pages that need serialized
  initial props.
- Avoid a frontend/router migration.

Choose Worker-owned Inertia if the team wants Inertia as the app architecture:

- Server-owned routing.
- Page props loaded by Worker routes.
- Same-origin browser traffic.
- Recurring API called only by Worker code.
- Inertia navigation protocol instead of SolidStart routing.
- Solid components through `inertia-adapter-solid@1.0.0-beta.3`.
- Shared Hono-shaped observability with `apps/sheets`.
- Explicit ownership of any Solid adapter fork.

Do not choose Worker-owned Inertia if the team wants to keep:

- SolidStart's current router and server-function model.
- Solid as the frontend framework without community adapter or fork risk.
- Component HTML SSR on Cloudflare Workers.

Choose SolidStart if avoiding a frontend/router migration is more important
than adopting Inertia's server-routed page protocol.

## Current Decision

Default to the SolidStart path for `apps/web` unless SolidStart route-data
serialization proves too awkward for authenticated pages:

- Keep `entry-server.tsx` standard.
- Keep `FileRoutes` server-visible in `app.tsx`.
- Do not add a global `clientOnly(FileRoutes)` boundary for routes that need
  first-response data.
- Add a server-only Recurring API facade.
- Use per-route server wrappers for pages that need serialized initial props.
- Move browser-only UI into `clientOnly` child components.
- Keep Google OAuth routes as Worker-side redirect/callback handlers.
- Keep Recurring API calls in Worker/server code only.

Keep Worker-owned Inertia as the next spike if the team decides the explicit
Inertia page-object and visit protocol is worth the migration:

- `@hono/inertia` on the Worker/server side.
- `inertia-adapter-solid@1.0.0-beta.3` on the client side.
- Hono-owned page routes and page props.
- Google OAuth routes as normal Hono redirect routes.
- Recurring API calls only from Worker code.
- Shared Hono observability patterns with `apps/sheets`.
- No component HTML SSR in the Worker deployment.

The first SolidStart spike should prove one authenticated vertical path:
first-response route data, one backend API call, Google OAuth redirects, and
telemetry fields.

The first Inertia spike should prove one authenticated vertical path only if
that path is selected: first page response, client navigation without full
reload, one backend API call, Google OAuth redirects, asset version behavior,
and telemetry fields.

## References

- Inertia protocol: https://www.inertiajs.com/the-protocol
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
- `inertia-adapter-solid`:
  https://github.com/iksaku/inertia-adapter-solid
