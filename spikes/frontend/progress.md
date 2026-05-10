# Frontend Spike Progress

Status: adopted

## Current Decision

The frontend path is the Inertia Worker app under `apps/inertia`.

The selected shape:

- Hono owns Cloudflare Worker routing.
- Inertia owns the page-response and visit protocol.
- The Worker calls the API declared by
  `packages/openapi/spec/recurring.responsible.ts`.
- Browser traffic stays same-origin.
- Browser does not call the Recurring API directly.
- Google OAuth start and callback routes run on the Worker.
- Component HTML SSR stays disabled for the Worker deployment.

## Remaining Work

- Keep generated API client output pointed at `apps/inertia/gen`.
- Keep Worker bindings as the production runtime config model.
- Keep Miniflare and browser tests focused on the Worker deployment shape.
- Share request IDs, context helpers, structured logging, backend fetch helpers,
  and trace propagation patterns with `apps/sheets` where useful.

## References

- Inertia protocol: https://www.inertiajs.com/the-protocol
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
- `inertia-adapter-solid`:
  https://github.com/iksaku/inertia-adapter-solid
