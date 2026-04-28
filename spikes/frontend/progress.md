# Frontend Spike Progress

## Comparison Update

As of April 28, 2026, Inertia's Cloudflare Workers story improved because Hono
now has experimental `@hono/inertia` middleware in the `honojs/middleware`
repository.

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
- Component HTML SSR on Cloudflare Workers.

Choose SolidStart if avoiding a frontend/router migration is more important
than adopting Inertia's server-routed page protocol.

## References

- Inertia protocol: https://www.inertiajs.com/the-protocol
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
