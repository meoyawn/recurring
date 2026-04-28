# Recommended Observability Stack for SolidStart Alpha 2 on Cloudflare Workers

As of April 28, 2026, the recommended production setup for `apps/web` as a
SolidStart alpha 2 app served by Cloudflare Workers is:

- browser tracing: OpenTelemetry browser SDK with document-load, fetch, XHR, and
  optional user-interaction instrumentation
- Solid Router navigation telemetry: app-owned wrapper around route changes for
  user-visible navigation spans
- SolidStart server telemetry: structured logs around server functions, API
  routes, middleware, and backend API calls
- Worker tracing: Cloudflare Workers automatic tracing for handler and outbound
  `fetch()` subrequest spans
- Worker logs: structured `console` JSON logs with request ID, Cloudflare Ray
  ID, route, server-function/API-route marker, auth state, and API target
- API propagation: explicit `traceparent` forwarding from browser same-origin
  requests through Worker API calls to the Recurring API
- transport and routing: OpenTelemetry Collector for app-owned browser/API
  telemetry, plus Cloudflare OTLP export for Worker traces and logs
- metrics: Web Vitals and route navigation measures from the browser, Cloudflare
  Worker built-in metrics, API and database metrics from the backend
- tracing backend: Tempo, Jaeger, Honeycomb, Sentry, Axiom, or another
  OTLP-compatible tracing system
- log backend: Loki, Elasticsearch, OpenSearch, or another log store

## Verdict

SolidStart is observable enough, but it does not provide a full observability
adapter or a framework-level tracing model.

That is acceptable for this app because the target shape keeps all privileged
work behind the Cloudflare Worker:

- browser renders the interactive UI
- browser calls same-origin SolidStart routes or server functions
- Worker calls the Recurring API declared by
  `packages/openapi/spec/recurring.responsible.ts`
- Go Echo API and PostgreSQL are instrumented normally downstream

The main constraint is the same one as the Inertia spike: Cloudflare Workers
automatic tracing is useful for Worker-local timing, but Cloudflare currently
documents that exported Worker trace IDs are not propagated to other services.
It also documents custom spans and attributes as roadmap work.

As of April 28, 2026, Hono now has experimental `@hono/inertia` middleware.
That weakens SolidStart's deployment/observability advantage when the desired
app model is Inertia-style page props: Inertia gets a concrete Hono integration
point for route, component, prop-key, and response-mode logging. SolidStart can
still be observed well, but it needs more app-owned conventions.

So the pragmatic recommendation is:

- use browser OpenTelemetry for document loads, soft navigations, server
  function calls, and same-origin API-route calls
- add app-owned Solid Router navigation spans because Solid Router does not emit
  an observability protocol
- enable Cloudflare automatic Worker tracing for Worker-local handler, binding,
  and subrequest timing
- forward W3C `traceparent` headers manually from Worker requests to Recurring
  API requests
- instrument the Go Echo API and PostgreSQL normally
- correlate Worker traces with app traces by `request_id`, `cf_ray`, route, URL,
  and timestamp until Cloudflare trace propagation matures

Do not choose SolidStart expecting one clean automatic trace from click to
PostgreSQL through Cloudflare Workers today.

## Runtime Shape

Target request flow:

```text
Browser
  |- document load span
  |- solid.route.navigation span
  |- fetch/XHR client span with traceparent
Cloudflare Worker
  |- Cloudflare automatic fetch handler span
  |- SolidStart route/API/server-function code
  |- Cloudflare automatic outbound fetch span to Recurring API
  |- structured logs with request_id/cf_ray/solid fields
Go Echo API
  |- HTTP server span from traceparent
  |- app spans
  |- PostgreSQL client spans
PostgreSQL
  |- DB spans/metrics through API-side instrumentation
```

This gives two practical views:

- user-facing view: browser route transitions, same-origin RPC/API requests, API
  spans, DB spans
- Worker-local view: Cloudflare handler timing, subrequest timing, CPU/wall
  time, Cloudflare colo, Ray ID, outcome

The ideal single trace needs Cloudflare to propagate trace context, or the app
to own a Worker-compatible custom tracing layer. Cloudflare's current docs say
automatic cross-service trace propagation is still in progress.

## SolidStart Runtime Surfaces

For this app, treat SolidStart as several observable surfaces rather than one
single protocol:

- document requests handled by the Worker
- UI route rendering in the browser
- Solid Router soft navigations
- SolidStart server functions generated from `"use server"`
- route data loaded through SolidStart data APIs
- API routes under `src/routes`
- OAuth routes and redirects
- outbound Worker `fetch()` calls to Google and the Recurring API

Unlike Inertia, SolidStart does not have a page-object protocol where initial
HTML and later visits share a named JSON envelope. Its serialization path is for
SolidStart server function arguments and return values.

This is the observability tradeoff. Inertia has one protocol envelope to label:
`component`, `props`, `url`, `version`, request mode, and asset version.
SolidStart has multiple surfaces to label consistently: document render,
route-wrapper query, server function, API route, and browser navigation.

That means observability should attach to the concrete request boundaries:

- top-level HTML document
- client navigation
- same-origin fetch/XHR
- server function or API route
- backend API call

## Browser Tracing

Use browser OpenTelemetry for real user monitoring.

Recommended browser instrumentations:

- `@opentelemetry/sdk-trace-web`
- `@opentelemetry/instrumentation-document-load`
- `@opentelemetry/instrumentation-fetch`
- `@opentelemetry/instrumentation-xml-http-request`
- optionally `@opentelemetry/instrumentation-user-interaction`

Use both fetch and XHR instrumentation. SolidStart server functions and route
data should usually use fetch, but using both avoids coupling telemetry to
framework internals or future transport changes.

Browser spans should include:

- `service.name=recurring-web`
- `deployment.environment`
- `app.framework=solidstart`
- `app.framework.version=2.0.0-alpha.2`
- `app.router=solid-router`
- `app.rendering=ssr-shell-client-ui`
- `app.route.path`
- `app.route.params.keys`
- `app.navigation.kind=document|soft|redirect|server-function|api-route`
- `app.server_function.name`
- `app.api_route.path`
- `app.auth.state=anonymous|session`

Configure fetch/XHR propagation only for allowed origins:

- the same web origin
- the browser OTLP collector endpoint, if using direct browser OTLP export

For this app's intended shape, browser application traffic should only call the
web origin. The browser should not call the Recurring API directly.

## Solid Router Navigation Spans

Add a small app-owned router telemetry module.

Solid Router supports standard anchors, `<A>`, `useNavigate`, redirects, and
reactive location state. It does not expose an Inertia-style navigation event
protocol, so the app should own route-transition spans.

Recommended sources:

- a root component that observes `useLocation()`
- wrapper helpers for app-owned `useNavigate()` calls
- optional wrapper component around app-owned links
- fetch/XHR spans for server function and API-route network work

Recommended span names:

- `solid.route.document GET /`
- `solid.route.navigate /dashboard`
- `solid.route.redirect /login`
- `solid.server_function getHomeProps`
- `solid.api_route GET /api/backend/v1/health`

Recommended attributes:

- `app.route.from`
- `app.route.to`
- `app.route.path`
- `app.route.search.keys`
- `app.route.hash.present`
- `app.navigation.replace`
- `app.navigation.delta`
- `app.navigation.trigger=link|navigate|redirect|popstate|unknown`
- `app.navigation.completed`
- `app.navigation.cancelled`
- `app.navigation.duration_ms`

Do not try to infer too much from URL strings. Use route-level wrapper code
where the app knows the logical route and feature name.

## Server Functions And Queries

Treat SolidStart server functions as same-origin RPC requests that execute in
the Worker.

Recommended server-function logs:

- `event=solid.server_function`
- `request_id`
- `cf_ray`
- `traceparent_present`
- `function`
- `route`
- `method`
- `status`
- `duration_ms`
- `api.calls.count`
- `api.calls.duration_ms`

Recommended query/action logs:

- `event=solid.query`
- `event=solid.action`
- `query.key`
- `action.name`
- `route`
- `status`
- `duration_ms`

Avoid logging function arguments or serialized return values by default. These
can contain user data.

If the first HTML response needs route data, the server-rendered route wrapper
from the frontend spike is the right place to log:

- query key
- route
- serialized payload byte size
- backend calls
- status

## Worker Tracing

Enable Cloudflare Workers traces in Wrangler.

```toml
[observability.traces]
enabled = true
head_sampling_rate = 0.05

[observability.logs]
enabled = true
head_sampling_rate = 0.6
```

Cloudflare automatic Worker tracing currently covers:

- Worker handler calls
- outbound `fetch()` calls
- supported binding calls

It also exports OpenTelemetry-compatible traces and logs to configured
destinations.

Important limitations:

- exported Worker trace IDs are not propagated to other services
- custom app spans and attributes inside Workers are not generally available yet
- service binding and Durable Object calls may appear as separate traces
- non-I/O spans can report `0 ms`
- Worker OTLP metrics export is not currently supported

For SolidStart, this means Cloudflare can show that a server function or route
handler made a slow API subrequest, but an external backend may not
automatically show that Worker span as the parent of the Go API span.

## Trace Propagation

Use W3C Trace Context headers.

For browser-initiated same-origin requests:

- browser fetch/XHR instrumentation injects `traceparent`
- Worker receives `traceparent`
- SolidStart server function or API route runs in the Worker
- Worker forwards `traceparent` when calling the Recurring API
- Echo extracts it and creates downstream spans
- PostgreSQL spans attach under the API request span

Until Cloudflare automatic trace propagation is fixed, prefer forwarding the
incoming `traceparent` unchanged instead of inventing a Worker child span that
is never exported. This keeps API and database spans connected to the browser
network span.

For first HTML visits:

- browser normally does not send `traceparent` on the top-level navigation
- Worker automatic tracing creates a Worker trace
- browser document-load tracing can measure the load after boot
- API calls made while rendering initial route data need `request_id` and
  `cf_ray` for correlation

Do not rely on a clean first-load browser-to-Worker trace unless a spike proves
that the Worker can expose or create usable trace context and export matching
spans.

## Initial HTML And Route Data

The preferred app shape from `spikes/frontend/solid.md` is `ssr: true` plus
client-rendered UI boundaries.

Track initial HTML separately from client-rendered route DOM:

- document request timing
- route wrapper timing
- server query timing
- serialized route-data byte size
- shell HTML byte size
- redirect status
- backend API calls

Worker logs should include:

- `event=solid.document`
- `request_id`
- `cf_ray`
- `method`
- `path`
- `route`
- `serialized.bytes`
- `api.calls.count`
- `api.calls.duration_ms`
- `status`

Browser telemetry should record:

- document load timing
- app boot timing
- first route path
- first route data fetch timing if data loads after client start
- hydration or mount error

Because the route body is intended to render in the browser, do not treat lack
of app-body SSR as an observability failure. The measurable question is whether
the initial route data arrives in the first HTML response or in a follow-up
same-origin request.

## Later Client Visits

Later visits can be a mix of:

- Solid Router soft navigations
- lazy route chunk loads
- SolidStart server function calls
- API route calls
- browser-only resource fetches

For each user-visible navigation, capture:

- from route
- to route
- navigation trigger
- route chunk load duration
- data fetch duration
- server function/API route status
- error boundary activation
- final render completion marker

The route span should describe what the user experienced. HTTP spans should
describe the network. Keep both.

## Backend API Calls

Centralize Worker-to-Recurring API calls behind a small server-only fetch
helper.

The helper should:

- read incoming `traceparent` and `tracestate`
- forward them to the Recurring API
- attach `x-request-id`
- attach a safe caller marker such as `recurring-web`
- log method, path, status, duration, retry count, and error class
- avoid logging request or response bodies by default

Recommended attributes/log fields:

- `event=recurring_api.fetch`
- `request_id`
- `cf_ray`
- `api.method`
- `api.path`
- `api.status`
- `api.duration_ms`
- `api.error_class`
- `traceparent_present`

This is the key project-specific rule: browser code should not call the
Recurring API directly, so backend API observability belongs in Worker
server-side code.

## Metrics

Use metrics from the systems that already produce them well.

Browser metrics:

- Core Web Vitals
- document load
- app boot
- soft navigation duration
- server function/API route request duration
- route error count

Worker metrics:

- request count
- error rate
- CPU time
- wall time
- subrequest count
- status code distribution
- Cloudflare colo

API metrics:

- Go Echo HTTP latency and count
- OpenAPI route labels
- PostgreSQL query latency
- PostgreSQL pool stats
- auth/signup failure counts

Cloudflare currently exports Workers traces and logs through OTLP, but not
Worker infrastructure metrics or custom metrics. Use Cloudflare dashboards or a
separate metrics path for Worker metrics.

## Logging

Use structured JSON logs everywhere.

Minimum Worker log fields:

- `service=recurring-web`
- `environment`
- `event`
- `request_id`
- `cf_ray`
- `trace_id`
- `span_id`
- `method`
- `path`
- `route`
- `status`
- `duration_ms`
- `user_id_hash`
- `session_present`
- `error_class`

Recommended event names:

- `solid.document`
- `solid.navigation`
- `solid.server_function`
- `solid.api_route`
- `solid.query`
- `solid.action`
- `recurring_api.fetch`
- `google_oauth.start`
- `google_oauth.callback`

Do not log:

- cookies
- session IDs
- OAuth codes
- OAuth tokens
- Google profile payloads
- serialized route data values
- Recurring API request/response bodies by default

## OAuth Routes

`apps/web/src/lib/googleAuth.ts` already has the right server-side shape:

- Worker handles `/auth/google/start`
- Worker handles `/auth/google/callback`
- Worker calls Google token and userinfo endpoints
- Worker calls the Recurring API
- Worker sets same-origin cookies
- browser receives redirects

Add OAuth-specific logs around each external step:

- `google_oauth.start`
- `google_oauth.callback`
- `google_oauth.token_exchange`
- `google_oauth.userinfo`
- `recurring_api.signup`
- `google_oauth.finish`

Recommended fields:

- `request_id`
- `cf_ray`
- `oauth.state_cookie_present`
- `oauth.error_present`
- `google.status`
- `recurring.status`
- `duration_ms`
- `result=success|redirect|failure`

Never log the authorization code, access token, session cookie, or raw Google
profile.

## Adapter Impact

SolidStart alpha 2 on Cloudflare Workers has more moving parts than a plain SPA:

- SolidStart alpha 2
- Vite 7
- `@solidjs/vite-plugin-nitro-2`
- Vinxi/Nitro server output
- Cloudflare Workers runtime
- Cloudflare Workers Assets or generated Wrangler config
- optional Node compatibility for async local storage

Observability should be verified against the generated Worker output, not only
against `vite dev`.

Current `apps/web` notes:

- `apps/web/package.json` uses `@solidjs/start` `2.0.0-alpha.2`
- `apps/web/vite.config.ts` currently sets `ssr: true`
- there is no `app.config.ts`
- `apps/web/src/app.tsx` renders `<FileRoutes />` directly
- `apps/web/src/routes/index.tsx` currently fetches `/api/backend/v1/health`
  from the browser
- `apps/web/src/lib/googleAuth.ts` already models server-side OAuth and backend
  API calls
- the generated `.output/nitro.json` observed during the spike used the
  `node-server` preset, so Cloudflare Worker output still needs explicit
  verification

For the frontend spike's intended shape, move toward:

- `ssr: true` or no `ssr` override
- Cloudflare module Worker preset
- `nodejs_compat` if async local storage needs it
- server-only Recurring API fetch helper
- browser calls only same-origin SolidStart routes/server functions

## Default Recommendation

For `apps/web`, choose this:

- browser: OpenTelemetry document-load, fetch, XHR, Web Vitals, and app-owned
  Solid Router navigation spans
- SolidStart: structured logs in middleware, server functions, API routes, and
  route-data wrappers
- Worker: Cloudflare automatic traces and logs with OTLP export
- propagation: forward incoming `traceparent`/`tracestate` from Worker to the
  Recurring API
- backend: OpenTelemetry Go SDK, Echo middleware, PostgreSQL instrumentation,
  and structured logs
- correlation: `request_id`, `cf_ray`, route, URL, timestamp, and safe user hash

This gives useful production debugging without betting on unstable framework or
Worker custom-span support.

If deployment and observability are weighted above keeping SolidStart, compare
this with the Inertia/Hono spike before standardizing. `@hono/inertia` gives
Inertia a clearer Worker route boundary and a named page-object protocol, while
SolidStart gives a more framework-native continuation of the current app.

## Avoid

- treating SolidStart serialization as an Inertia-style page-props protocol
- assuming SolidStart route wrappers will produce Inertia-like observability
  without explicit labels and log fields
- relying on Cloudflare Worker traces to automatically parent Go API traces
- adding browser calls directly to the Recurring API
- logging serialized route data, OAuth tokens, session IDs, or Google profile
  payloads
- building a Worker custom tracing layer before Cloudflare's custom span support
  is mature
- assuming `vite dev` observability matches Cloudflare Worker production output
- adding high-cardinality route params or user identifiers as raw span
  attributes

## Recommended Spike

Build a thin vertical slice before standardizing.

1. Switch `apps/web` to the SolidStart shape from `spikes/frontend/solid.md`.
2. Configure Cloudflare Worker output and Wrangler observability.
3. Add browser OpenTelemetry with document-load and fetch instrumentation.
4. Add a root route observer that records `solid.route.navigate` spans.
5. Add a server-only Recurring API fetch helper that forwards `traceparent`.
6. Move the health check behind a server function or API route.
7. Add structured logs for document, server function/API route, backend fetch,
   and OAuth callback paths.
8. Deploy to a staging Worker.
9. Verify these flows:
   - first document load
   - soft navigation
   - server function/API route call
   - health API call through Worker to Echo
   - Google OAuth start and callback failure path
10. Confirm whether traces join automatically anywhere. If not, document the
    exact correlation fields needed in the tracing/log backend.

Acceptance criteria:

- browser route span is visible
- same-origin fetch span carries `traceparent`
- Worker logs include `request_id` and `cf_ray`
- Worker automatic trace shows handler and outbound `fetch()`
- Echo API trace continues from forwarded `traceparent`
- no browser request goes directly to the Recurring API origin
- no sensitive OAuth/session values appear in logs

## Evidence Level

Known-supported:

- SolidStart supports SSR, CSR, server functions, serialization, middleware, and
  Nitro deployment presets.
- SolidStart v2 defaults serialization to JSON for stronger CSP compatibility.
- Cloudflare documents SolidStart on Workers as beta.
- Cloudflare Workers automatic tracing captures handler, outbound `fetch()`, and
  supported binding spans.
- Cloudflare Workers can export OTLP traces and logs.
- OpenTelemetry browser instrumentation supports document-load, fetch, XHR, and
  user-interaction instrumentation, with browser instrumentation still marked
  experimental.

Less proven:

- SolidStart alpha 2 plus `@solidjs/vite-plugin-nitro-2` on Cloudflare Workers
  as a long-lived production target.
- A global `clientOnly` route boundary around all app UI.
- High-quality route navigation spans from Solid Router without app-owned
  wrappers.
- Clean end-to-end trace parenting through Cloudflare Worker OTLP export.

Treat the first implementation as a production-oriented spike, not a final
observability platform.

## References

- SolidStart `defineConfig`:
  https://docs.solidjs.com/solid-start/reference/config/define-config
- SolidStart serialization:
  https://docs.solidjs.com/solid-start/advanced/serialization
- SolidStart `"use server"`:
  https://docs.solidjs.com/solid-start/reference/server/use-server
- SolidStart `createMiddleware`:
  https://docs.solidjs.com/solid-start/reference/server/create-middleware
- SolidStart `FileRoutes`:
  https://docs.solidjs.com/solid-start/reference/routing/file-routes
- Solid Router navigation:
  https://docs.solidjs.com/solid-router/concepts/navigation
- Solid Router `useLocation`:
  https://docs.solidjs.com/solid-router/reference/primitives/use-location
- Cloudflare Workers SolidStart guide:
  https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/solid/
- Cloudflare Workers traces:
  https://developers.cloudflare.com/workers/observability/traces/
- Cloudflare Workers trace limitations:
  https://developers.cloudflare.com/workers/observability/traces/known-limitations/
- Cloudflare Workers OTLP export:
  https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/
- OpenTelemetry JavaScript browser:
  https://opentelemetry.io/docs/languages/js/getting-started/browser/
- Frontend SolidStart spike: ../frontend/solid.md
- Inertia observability spike: ./inertia.md
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
