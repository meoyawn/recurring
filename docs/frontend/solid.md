# SolidStart SSR With Client-Rendered UI On Cloudflare Workers

## Goal

Deploy `apps/web` to Cloudflare Workers as a server-backed SolidStart app that
renders the interactive app UI in the browser.

Desired behavior:

- Cloudflare Worker handles the initial document request.
- Server can run request-scoped logic.
- Server can use SolidStart data APIs and server functions.
- Initial route data can be serialized through SolidStart.
- Server does not render the app body DOM.
- Browser renders the interactive DOM client-side.
- Browser avoids hydrating a server-rendered app body.
- Browser does not call the Recurring API directly.
- Cloudflare Worker calls the API declared by
  `packages/openapi/spec/recurring.responsible.ts`.

## Problem

`apps/web` currently uses `ssr: false`, but pure CSR disables the normal
SolidStart SSR document/data pipeline. We still need a Cloudflare Worker that
can run request-scoped code, set cookies, call the Recurring API server-side,
and use SolidStart route data without rendering the app body.

`apps/web/src/lib/googleAuth.ts` is already written for this shape: the worker
handles the Google OAuth callback, calls Google and the backend server-side,
then sets a same-origin session cookie before redirecting back to the app.

## Decision

Prefer `ssr: true` plus `clientOnly` over `ssr: false` for this app.

`ssr: false` gives pure CSR and can still use server functions, but it disables
the normal SSR/hydration data path.

`ssr: true` keeps SolidStart's server render pipeline available. Then
`clientOnly` can move browser-only UI behind a client-side boundary while route
wrappers, queries, server functions, metadata, and request context remain
server-capable.

The intended end state is not SEO SSR for the app body. It is worker-side
document handling plus client-side app rendering:

- Worker renders shell HTML and serializes SolidStart route data when needed.
- Worker does not render the route body DOM.
- Browser mounts the UI.
- Later browser interactions call SolidStart routes or server functions, which
  call the Recurring API from the worker.

## SolidStart Route Data Only

Inertia owns a protocol: initial HTML includes a JSON encoded page object, and
later visits return JSON. Its adapters hide that serialization.

SolidStart serialization is not that protocol. It serializes server function
arguments and return values for SolidStart's own data path. With `ssr: false`,
there is no automatic arbitrary page-props channel in the document.

First-load data should be expressed as SolidStart queries/server functions under
`ssr: true`, with server wrappers only where the first HTML response needs
serialized route data.

## Patterns

### Global Client-Only Routes

One boundary can wrap all UI routes:

```tsx
// src/ClientRoutes.tsx
import { FileRoutes } from "@solidjs/start/router"

export default function ClientRoutes() {
  return <FileRoutes />
}
```

```tsx
// src/app.tsx
import { MetaProvider, Title } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { clientOnly } from "@solidjs/start"
import { Suspense } from "solid-js"
import "./app.css"

const ClientRoutes = clientOnly(() => import("./ClientRoutes"))

export default function App() {
  return (
    <Router
      root={props => (
        <MetaProvider>
          <Title>Recurring</Title>
          <nav class="nav">
            <a href="/">Home</a>
          </nav>
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <ClientRoutes />
    </Router>
  )
}
```

Tradeoff:

- Least route-file ceremony.
- Page DOM is rendered only in browser.
- Route-level data behind this boundary will usually fetch after client start,
  because the route component itself is not server-rendered.
- Data that must be serialized into the first HTML response should be lifted
  into a server-rendered route wrapper.
- This is supported by the `clientOnly` primitive, but wrapping all `FileRoutes`
  is an extrapolated pattern, not a heavily documented public recipe.

### Per-Route Server Wrapper

Use when a route needs initial props serialized into the first HTML response:

```tsx
import { createAsync, query } from "@solidjs/router"
import { clientOnly } from "@solidjs/start"

const ClientHome = clientOnly(() => import("~/components/ClientHome"))

const getHomeProps = query(async () => {
  "use server"
  return { apiBase: "/api/backend" }
}, "home-props")

export default function Home() {
  const props = createAsync(() => getHomeProps())
  return <ClientHome props={props()} fallback={null} />
}
```

Tradeoff:

- More like Inertia: server route wrapper resolves data, client component
  renders DOM.
- More per-route ceremony.
- Stronger fit when first response should carry route props through SolidStart
  route serialization.

## Evidence Level

Known-supported:

- SolidStart supports SSR, CSR, and server functions.
- `clientOnly` is documented for components and entire pages.
- Community examples use `clientOnly` for browser-only pages/widgets such as
  charts, maps, data grids, and DOM-dependent libraries.

Less proven:

- A single global `clientOnly` wrapper around all `FileRoutes`.
- Treat as a pragmatic experiment. Verify build output and first-load data
  behavior before relying on it widely.

## Current Web App Implication

`apps/web` currently has `ssr: false`. To try this approach:

- Switch to `ssr: true` or remove the `ssr` override.
- Keep `entry-server.tsx` standard.
- Add a `ClientRoutes` boundary if route data can load after client start.
- Use per-route wrappers for routes that need first-response props.
- Configure Nitro for Cloudflare Workers using a Cloudflare worker/module preset
  rather than the default Node server preset.
- Call the API declared by `packages/openapi/spec/recurring.responsible.ts` from
  Cloudflare Worker server code, not from browser code.

## References

- SolidStart `clientOnly`:
  https://docs.solidjs.com/solid-start/reference/client/client-only
- SolidStart serialization:
  https://docs.solidjs.com/solid-start/advanced/serialization
- SolidStart `"use server"`:
  https://docs.solidjs.com/solid-start/reference/server/use-server
- Inertia protocol: https://www.inertiajs.com/the-protocol
