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

Pure CSR with `ssr: false` disables the normal SolidStart SSR document/data
pipeline. We still need a Cloudflare Worker that can run request-scoped code,
set cookies, call the Recurring API server-side, and use SolidStart route data
without rendering the app body.

`apps/web` has since moved to `ssr: true`, which matches this spike's preferred
direction. The remaining question is whether SolidStart's route-data
serialization is the right app protocol, not whether CSR-only can support the
required server work.

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

The boundary is deliberately asymmetric:

- Keep the SolidStart app, router root, layouts, and data-owning route wrappers
  visible to the server.
- Put browser-only interactive UI behind `clientOnly`.
- Do not put `FileRoutes`, data-owning route modules, or auth/layout wrappers
  behind `clientOnly` when first-response data matters.

The intended end state is not SEO SSR for the app body. It is worker-side
document handling plus client-side app rendering:

- Worker renders shell HTML and serializes SolidStart route data when needed.
- Worker does not render the route body DOM.
- Browser mounts the UI.
- Later browser interactions call SolidStart routes or server functions, which
  call the Recurring API from the worker.

See `progress.md` for cross-spike progress.

## Pattern From Hackers Pub `web-next`

Studied `hackers-pub/hackerspub` at `fa755c8486b31e41d0c5dab0c7943ea1e3822a64`,
focused on `web-next`.

Relevant patterns:

- SolidStart 2 is configured directly in `vite.config.ts` with `solidStart()`
  and `nitroV2Plugin()`. There is no `ssr: false` app mode.
- `src/entry-client.tsx` and `src/entry-server.tsx` stay standard: mount
  `StartClient` in the browser, use `createHandler` plus `StartServer` on the
  server, and put `{children}` inside `<div id="app">`.
- `src/app.tsx` owns cross-route providers around the router root:
  `RelayEnvironmentProvider`, `MetaProvider`, i18n provider, and `Suspense`.
- `src/routes.tsx` returns plain `<FileRoutes />`. The route tree stays
  server-visible.
- Layout and page routes export `route.preload()` and use `query()` plus
  `loadQuery()`; components read the result with `createPreloadedQuery()`.
- Backend access is centralized in `src/RelayEnvironment.tsx`. Its fetch
  function is a server function, reads the request cookie via
  `getRequestEvent()` / `getCookie()`, and sends backend auth from server-side
  code.
- Route API handlers are used for request/response protocol work such as login
  callback cookies, `robots.txt`, and sitemap XML.

This is not a reason to copy Hackers Pub's SEO/body SSR behavior. The reusable
lesson is structural: keep the router, route files, request context, and data
fetching layer server-visible; put only the UI subtree that must be browser-only
behind `clientOnly`.

For Recurring, the equivalent shape is:

- Keep `apps/web/src/app.tsx` as a server-visible router/provider shell.
- Keep `<FileRoutes />` directly server-visible.
- Define a server-only Recurring API client/facade that calls the API declared
  by `packages/openapi/spec/recurring.responsible.ts`.
- Put first-load data in SolidStart `query()` / `createAsync()` from route
  wrappers.
- Pass serialized data into `clientOnly` UI children.
- Route later browser interactions through SolidStart server functions or API
  routes; those call the Recurring API from the worker.

## SolidStart Route Data Only

SolidStart serialization serializes server function arguments and return values
for SolidStart's own data path. With `ssr: false`, there is no automatic
arbitrary page-props channel in the document.

First-load data should be expressed as SolidStart queries/server functions under
`ssr: true`, with server wrappers only where the first HTML response needs
serialized route data.

## Constraint Learned From Spike

If initial props must be serialized into the first HTML response, the route file
must remain visible to the server render.

Wrapping all `FileRoutes` in `clientOnly` makes the whole route tree
client-only. The server then renders only the app shell, does not execute the
route component during SSR, and cannot resolve or serialize route-level
`query()` / `createAsync()` data for the first response.

Local proof in `apps/web`:

- Normal SSR route wrapper with `query()` returned `solid-initial-props-proof`.
- First HTML contained that marker in both rendered DOM and SolidStart
  serialized route data.
- The same route behind global `clientOnly(FileRoutes)` returned only shell/nav
  HTML.
- First HTML had no route body DOM and no serialized marker.

Therefore:

- Use global `clientOnly(FileRoutes)` only for routes whose data may load after
  the browser starts.
- Do not export a data-owning route module itself as `clientOnly` when the route
  needs first-response data.
- Use a server-rendered route wrapper plus a client-only child component for
  routes that need serialized initial props.

## Patterns

### Global Client-Only Routes

One boundary can wrap all UI routes only when first-response route data is not
required:

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
- Route-level data behind this boundary fetches after client start because the
  route component itself is not server-rendered.
- Data that must be serialized into the first HTML response cannot live behind
  this boundary.
- Local spike showed no route body DOM and no serialized route data in the first
  HTML response.
- This pattern is unsuitable for this app if serialized initial props are a hard
  requirement for most authenticated pages.

### Per-Route Server Wrapper

Use when a route needs initial props serialized into the first HTML response:

```tsx
import { createAsync, query } from "@solidjs/router"
import { clientOnly } from "@solidjs/start"

const ClientHome = clientOnly(() => import("~/components/ClientHome"))

const getHomeProps = query(async () => {
  "use server"
  return { health: await recurringApi.health() }
}, "home-props")

export default function Home() {
  const props = createAsync(() => getHomeProps())
  return <ClientHome props={props()} fallback={null} />
}
```

Tradeoff:

- Server route wrapper resolves data, client-only component renders DOM.
- More per-route ceremony.
- Stronger fit when first response should carry route props through SolidStart
  route serialization.
- Avoid exporting the whole route as `clientOnly`; only the browser-only child
  component should be client-only.
- Keep returned values plain-serializable. Treat query output as an app-data
  snapshot, not as a transport for live clients, request objects, or functions.

### Server API Facade

Use a single server-only layer for Recurring API calls:

```ts
import { query } from "@solidjs/router"
import { getCookie } from "@solidjs/start/http"
import { getRequestEvent } from "solid-js/web"

export const getHomeProps = query(async () => {
  "use server"
  const event = getRequestEvent()
  const sessionID = event
    ? getCookie(event.nativeEvent, "sessionID")
    : undefined
  return recurringApi.home({ sessionID })
}, "home-props")
```

Guidance:

- Keep this layer importable only from server functions, route API handlers, or
  server-only query functions.
- Read request-scoped auth from the SolidStart request event, not from browser
  state.
- Return plain data to the client UI.
- Do not expose backend origin, backend bearer/session credentials, or generated
  OpenAPI clients to browser bundles.

## Evidence Level

Known-supported:

- SolidStart supports SSR, CSR, and server functions.
- `clientOnly` is documented for components and entire pages.
- SolidStart 2 is moving to a pure Vite-based system.
- Community examples use `clientOnly` for browser-only pages/widgets such as
  charts, maps, data grids, and DOM-dependent libraries.
- Hackers Pub `web-next` validates the SolidStart 2 shape of Vite plugin, Nitro
  v2 plugin, standard entries, server-visible `FileRoutes`, route `query()` /
  preload data, request-cookie-aware server functions, and API route handlers.

Less proven:

- Whether per-route wrappers stay ergonomic as the app grows.
- Whether SolidStart route serialization is close enough to the desired
  page-props model for authenticated pages.

Rejected by local spike:

- A single global `clientOnly` wrapper around all `FileRoutes` when routes need
  serialized initial props.

## Current Web App Implication

`apps/web` currently has `ssr: true`. To try this approach:

- Keep `entry-server.tsx` standard.
- Keep `FileRoutes` server-visible in `app.tsx`.
- Do not add a global `ClientRoutes` boundary for authenticated pages that need
  serialized initial props.
- Use per-route server wrappers for routes that need first-response props.
- Move browser-only UI into `clientOnly` child components imported from those
  wrappers.
- Add a server-only Recurring API facade and call it from SolidStart queries,
  server functions, or route API handlers.
- Use the SolidStart 2 Vite-based deployment path for Cloudflare Workers.
- Call the API declared by `packages/openapi/spec/recurring.responsible.ts` from
  Cloudflare Worker server code, not from browser code.

## References

- SolidStart `clientOnly`:
  https://docs.solidjs.com/solid-start/reference/client/client-only
- SolidStart serialization:
  https://docs.solidjs.com/solid-start/advanced/serialization
- SolidStart `"use server"`:
  https://docs.solidjs.com/solid-start/reference/server/use-server
- SolidStart 2 public roadmap:
  https://github.com/solidjs/solid-start/discussions/1960
- Hackers Pub `web-next` studied source:
  https://github.com/hackers-pub/hackerspub/tree/fa755c8486b31e41d0c5dab0c7943ea1e3822a64/web-next
