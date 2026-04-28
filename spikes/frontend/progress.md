# Frontend Spike Progress

## Comparison Update

As of April 28, 2026, Inertia's Cloudflare Workers story improved because Hono
now has experimental `@hono/inertia` middleware in the `honojs/middleware`
repository.

The current direction now leans toward Worker-owned Inertia:

- Use Hono as the web routing/runtime layer.
- Use experimental `@hono/inertia` for the server-side Inertia response
  protocol.
- Keep Solid as the component layer by starting from the freshest
  `inertia-adapter-solid` beta.
- Accept maintaining a fork and contributing upstream if the Solid adapter needs
  protocol or Inertia core compatibility fixes.
- Keep Inertia SSR disabled for Cloudflare Workers.

That changes the framework tradeoff:

- SolidStart remains the conservative choice if keeping SolidStart's router,
  server functions, and current app shape matters most.
- Inertia is now the stronger fit if the required product protocol is
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

Proceed with an Inertia spike unless a new blocker appears:

- `@hono/inertia` on the Worker/server side.
- `inertia-adapter-solid@1.0.0-beta.3` on the client side.
- Hono-owned page routes and page props.
- Google OAuth routes as normal Hono redirect routes.
- Recurring API calls only from Worker code.
- Shared Hono observability patterns with `apps/sheets`.
- No component HTML SSR in the Worker deployment.

The first spike should prove one vertical path: first page response, client
navigation, one backend API call, Google OAuth redirects, and telemetry fields.

## References

- Inertia protocol: https://www.inertiajs.com/the-protocol
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
- `inertia-adapter-solid`:
  https://github.com/iksaku/inertia-adapter-solid
