# Server-First Observability for Inertia on Cloudflare Workers

As of May 10, 2026, the Inertia spike should not start with browser-side
telemetry. The first useful milestone is Worker-owned observability for the
Inertia server boundary, OAuth routes, and Recurring API calls.

This keeps the work focused:

- no browser OpenTelemetry setup yet
- no client-side Inertia router span bridge yet
- the Cloudflare Worker starts and ends the app-owned trace for now
- the Worker forwards trace context to the Go API
- the Worker emits trace spans and response correlation headers that make
  Inertia response decisions, backend calls, request IDs, and OAuth outcomes
  debuggable through the trace backend

Future browser JavaScript can join this model later by sending `traceparent` on
Inertia XHR visits. That is intentionally not critical for the current spike.

## Current App State

`apps/inertia` already has the right runtime shape for a server-first spike:

- Hono Worker entrypoint: `apps/inertia/src/worker.ts`
- `@hono/inertia` middleware installed and used
- Solid Inertia adapter installed
- route handlers call `c.render(component, props)`
- Recurring API client calls use `@recurring/shared-ts` `serviceFetch`
- incoming `traceparent` and `tracestate` are already forwarded to the API
- miniflare tests already cover trace-header forwarding
- miniflare tests already cover Inertia asset mismatch responses

The missing work is not basic Inertia wiring. The missing work is app-owned
observability around the Worker boundary.

## Target Runtime Shape

Current phase:

```text
Browser
  |- normal document request
  |- later Inertia XHR without app-owned browser tracing for now

Cloudflare Worker
  |- app-owned root trace span starts here
  |- Hono request ID middleware creates or accepts request ID
  |- Hono route handler loads props
  |- @hono/inertia chooses HTML, page JSON, props JSON, or asset mismatch
  |- traced Recurring API fetch forwards trace context and request ID
  |- trace correlation headers are attached to the response
  |- app-owned root trace span ends here

Go Echo API
  |- extracts Worker trace context
  |- creates downstream API spans
  |- PostgreSQL spans attach under API request span

PostgreSQL
  |- DB spans and metrics through API instrumentation
```

Future phase:

```text
Browser
  |- document-load span
  |- Inertia router event spans
  |- XHR/fetch instrumentation sends traceparent

Cloudflare Worker
  |- extracts browser trace context
  |- creates child Worker span
  |- forwards child context to API
```

## Trace Ownership

The current spike should treat the Worker as the root of the app-owned
distributed trace.

Cloudflare automatic Worker tracing is still useful, but it is not enough for
this requirement by itself:

- it captures handler and outbound `fetch()` timing
- it exports Worker-local spans when configured
- it does not give the app reliable Hono-level route attributes
- it does not solve app-owned trace propagation to the API by itself
- custom app spans and attributes in Cloudflare's automatic tracing remain a
  limitation

So the Worker needs an app-owned tracing path in addition to Cloudflare
automatic tracing.

Preferred order:

1. Try official Hono-maintained tracing first: `@hono/otel`.
2. For Cloudflare Workers runtime support, pair it with the Worker-compatible
   OpenTelemetry provider/exporter required by the package docs, such as
   `@microlabs/otel-cf-workers`, if it is compatible with the app's current
   Wrangler/Vite setup.
3. If the official Hono middleware cannot satisfy Workers runtime constraints,
   keep the fallback small and isolated: one Worker tracing middleware, one
   trace-context helper, and no broad hand-built observability framework.

The fallback is acceptable only if it preserves these properties:

- one root span per Worker request
- route, method, status, and duration attributes
- safe Inertia attributes
- safe OAuth attributes
- trace context injected into Recurring API calls
- request ID included in every span, response, and API call

## Hono Libraries

Prefer Hono libraries where they exist.

Use:

- `hono/request-id` for request IDs
- `@hono/otel` for Hono request tracing if it works cleanly on Workers
- `@hono/inertia` for the Inertia server adapter

Do not hand-code replacements for those responsibilities unless the library
does not work in the Cloudflare Workers runtime or cannot expose the required
data.

Important clarification: an Inertia router telemetry module is not a Hono
library. It would be browser-side code around `@inertiajs/core` router events.
That work is deferred with browser telemetry.

For the server-side equivalent, instrument Hono and `@hono/inertia` boundaries:

- middleware before and after the route handler
- a `renderInertiaPage()` helper around `c.render(component, props)`
- `serviceFetch` hooks around backend calls
- OAuth route wrappers around redirect, token exchange, profile fetch, and
  session creation

## Worker Request IDs

Add request ID middleware early in the Hono stack.

Preferred behavior:

- accept inbound `X-Request-Id` if present
- otherwise use Cloudflare Ray ID as the first generated ID source
- otherwise fall back to `crypto.randomUUID()`
- set `X-Request-Id` on the response
- forward request ID to Recurring API calls
- include request ID in every Worker-owned span

Cloudflare Ray ID source:

- read `CF-Ray` from request headers when present
- confirm exact casing and availability in production
- confirm whether Miniflare exposes it
- if Miniflare does not expose it, tests should cover fallback generation

This gives stable correlation immediately without inventing a second ID when
Cloudflare already gave the request one.

## Worker Tracing Config

Enable Cloudflare automatic traces in `apps/inertia/wrangler.toml`:

```toml
[observability.traces]
enabled = true
head_sampling_rate = 0.05
```

If exporting to an external backend, configure Cloudflare Observability
destinations separately and add destination names to Wrangler only after the
destination exists.

Cloudflare automatic traces are the Worker-local view. App-owned Hono tracing is
the distributed trace view from Worker to API to PostgreSQL.

## Trace Propagation

Current state:

- `apps/inertia/src/app/api.ts` already reads `traceparent`
- `apps/inertia/src/app/api.ts` already reads `tracestate`
- `serviceFetch` already writes those headers to Recurring API requests
- test coverage already verifies forwarding

Needed change:

- when no inbound `traceparent` exists, the Worker tracing middleware should
  create a root trace context
- Recurring API calls should receive that Worker trace context
- if future browser telemetry sends `traceparent`, the Worker should extract it
  and create a child server span

This is what makes the end-to-end app trace start at the Worker today and later
extend naturally back into the browser.

## Inertia Server Trace Attributes

Add trace attributes around the Inertia route boundary.

Create a helper such as:

```ts
renderInertiaPage(c, component, props, options)
```

Responsibilities:

- call `c.render(component, props)`
- attach component name
- attach prop keys, not prop values
- attach serialized prop byte size
- attach asset version
- attach request mode
- attach response mode
- attach partial reload request headers
- attach status
- attach `X-Inertia` response header
- attach `Vary`
- attach `X-Inertia-Location` for asset mismatch

Response modes:

- `html`: normal first-page response
- `page-json`: `X-Inertia: true` page object response
- `props-json`: `Accept: application/json` props response
- `asset-mismatch`: `409` plus `X-Inertia-Location`

Trace attributes for every Inertia request:

- `service=recurring-web-worker`
- `environment`
- `request_id`
- `cf_ray`
- `trace_id`
- `traceparent_in`
- `tracestate_in`
- `method`
- `path`
- `route`
- `hono_route`
- `inertia_adapter=@hono/inertia`
- `inertia`
- `inertia_component`
- `inertia_partial`
- `inertia_partial_component`
- `inertia_partial_data`
- `inertia_partial_except`
- `inertia_response_mode`
- `inertia_asset_mismatch`
- `inertia_asset_version`
- `props_keys`
- `props_bytes`
- `status`
- `duration_ms`
- `api_calls_count`
- `api_duration_ms`
- `api_status_class`

Never attach prop values.

## API Call Summaries

Extend `serviceFetch` usage in `apps/inertia/src/app/api.ts`.

Use existing hooks:

- `onAttempt`
- `onResponse`
- `onError`

Capture per request:

- API call count
- total API duration
- max API duration
- API status class
- retry count
- target service name
- target path or route template, not full sensitive URLs
- error class when failed

The summary should be available to:

- `renderInertiaPage()`
- Worker span attributes
- OAuth route spans

Keep detailed backend telemetry in the Go API. The Worker should trace safe
summaries, not duplicate backend internals.

## OAuth Routes

Add safe telemetry around Google OAuth routes.

Track:

- `/auth/google/start` redirect creation
- OAuth state cookie set result
- `/auth/google/callback` status
- callback error class
- state validation result
- Google token exchange duration
- Google token exchange status class
- Google userinfo duration
- Google userinfo status class
- Recurring API session creation duration
- Recurring API session creation status class
- session cookie set result
- final redirect target path

Never attach to spans:

- authorization code
- access token
- refresh token
- ID token
- client secret
- raw cookie header
- session ID
- Google OAuth state value
- full profile payload

OAuth routes are not Inertia responses, but they must share the same request ID,
trace context, and API summary shape.

## Shared Hono Surface

Share Hono observability concepts between `apps/inertia` and `apps/sheets`
where runtime assumptions allow it.

Shared code should include:

- request ID options and field names
- request context shape
- trace-context extraction/injection helpers
- backend fetch summary shape
- safe error serialization
- route and target-service naming conventions

Runtime-specific code should stay separate:

- Cloudflare Worker provider/exporter setup for `apps/inertia`
- Bun/OpenTelemetry setup for `apps/sheets`
- Cloudflare automatic tracing config
- Worker-specific `CF-Ray` extraction

This keeps shared code honest: share schema and Hono behavior, not runtime
internals.

## Deferred Browser Work

Do not implement these in the current spike:

- browser OpenTelemetry SDK setup
- document-load instrumentation
- XHR instrumentation
- fetch instrumentation
- user-interaction instrumentation
- Web Vitals
- client-side Inertia router spans
- browser telemetry export endpoint

Leave room for them:

- accept inbound `traceparent`
- keep propagation origin policy documented for later
- keep Inertia router telemetry as a future module
- keep span attribute names compatible with future browser spans

The future client module would listen to Inertia router events and create
logical `inertia.visit` spans. It is not Hono code and should not block the
server-first spike.

## Implementation Work

1. Remove browser telemetry from current scope.

   Do not add browser OpenTelemetry packages or client instrumentation yet.
   Keep `apps/inertia/src/client.tsx` focused on app boot.

2. Defer Inertia router telemetry.

   This is not a Hono library. It is browser-side code over Inertia router
   events. The server-first equivalent is Hono tracing around
   `@hono/inertia` and `c.render()`.

3. Add Worker request observability middleware.

   Use `hono/request-id` for request IDs. Prefer `@hono/otel` for Hono tracing
   if compatible with Cloudflare Workers. The trace must start at the Worker
   request and end when the Worker response is complete.

4. Add `renderInertiaPage()`.

   Replace direct `c.render("Home", props)` calls with a helper that records
   component, prop keys, prop bytes, request mode, response mode, status, and
   API summary.

5. Add API call summaries.

   Keep trace forwarding in `serviceFetch`, but add hook-based timing and
   status summaries for Worker spans.

6. Add request ID generation and propagation.

   Reuse `CF-Ray` as the generated request ID when possible. Fall back to
   `crypto.randomUUID()` where `CF-Ray` is absent, including Miniflare if needed.

7. Add OAuth telemetry.

   Attach safe OAuth status and timing fields. Do not trace secrets, tokens, codes,
   raw cookies, session IDs, or OAuth state values.

8. Enable Wrangler observability.

   Add `[observability.traces]` to `apps/inertia/wrangler.toml`.

9. Factor shared Hono observability helpers.

   Put shared schema/helpers in shared TS code only after `apps/inertia` proves
   the shape. Keep Worker runtime setup local to `apps/inertia`.

10. Add acceptance tests.

    Cover request ID behavior, trace propagation, API summaries,
    Inertia response modes, asset mismatch, partial reload fields, and OAuth
    safe telemetry.

## Success Criteria

Backend prerequisite:

- `spikes/observability/backend.md` has selected either Jaeger v2 with Badger or
  OpenObserve single-node local mode for the current proof.
- `compose/docker-compose.yml` runs the selected backend with persistent local
  storage and an OTLP endpoint reachable by local app services.
- A trace can be fetched from the selected backend by exact `trace_id` through
  an API, not UI scraping.

Response correlation:

- Every Worker response includes `X-Request-Id`, `x-trace-id`, and `x-span-id`.
- Optional debug exposure of `traceparent` is documented before enabling it.
- When `CF-Ray` is present, the generated request ID uses it. When `CF-Ray` is
  absent, including in Miniflare, request ID generation falls back to
  `crypto.randomUUID()`.
- Recurring API calls receive `traceparent`, `tracestate` when present, and
  `X-Request-Id`.

Worker trace:

- A normal first HTML response creates a Worker-owned root trace when no inbound
  `traceparent` exists.
- A later request with inbound `traceparent` extracts that context and creates a
  Worker server span under it.
- The Worker span includes safe core attributes: `service.name`,
  `deployment.environment`, `request_id`, `app.route.path`,
  `http.request.method`, `http.response.status_code`, and `error.type` when
  failed.
- The Worker span includes safe Inertia attributes for component name, prop
  keys, prop byte size, request mode, response mode, status, asset version, and
  partial reload fields.
- Prop values are never attached to spans.

Inertia protocol coverage:

- First-page document response is traced with `html` response mode.
- Inertia `X-Inertia: true` request is traced with `page-json` response mode.
- `Accept: application/json` props request is traced with `props-json` response
  mode.
- Asset version mismatch is traced with status `409`, `asset-mismatch` response
  mode, and `X-Inertia-Location`.
- Partial reload request is traced with requested prop keys and component name.

Backend span linkage:

- Recurring API spans appear under the Worker-started trace in the selected
  backend.
- PostgreSQL spans appear under the API span when backend database
  instrumentation is enabled.
- The same trace can be summarized by service, operation, duration, status, and
  parent-child relationship from backend API results.

OAuth tracing:

- `/auth/google/start` and `/auth/google/callback` create Worker spans or span
  events with safe status and timing attributes.
- OAuth spans never include authorization codes, access tokens, refresh tokens,
  ID tokens, client secrets, raw cookies, session IDs, OAuth state values, or
  full profile payloads.

Automated checks:

- Miniflare tests cover request ID fallback when `CF-Ray` is absent.
- Miniflare tests cover response correlation headers.
- Miniflare tests cover trace propagation to Recurring API calls.
- Miniflare tests cover Inertia response modes, asset mismatch, and partial
  reload trace attributes.
- Tests or a documented local smoke command prove exact trace lookup in the
  selected backend after a browser click.

Explicit non-goals:

- Browser OpenTelemetry is not required for this spike.
- Inertia router event spans are not required for this spike.
- Structured application logs are not required for this spike.
- Cloudflare automatic trace correlation is useful evidence, but the success
  path is the app-owned Worker-to-API-to-PostgreSQL trace in the selected
  backend.

## Avoid

- adding browser telemetry in this phase
- assuming Inertia has built-in tracing
- assuming `@hono/inertia` exposes protocol decisions by itself
- hand-coding request IDs instead of using `hono/request-id`
- hand-coding Hono tracing before trying `@hono/otel`
- relying only on Cloudflare automatic tracing for app-owned distributed traces
- attaching Inertia prop payloads to spans
- attaching OAuth secrets, OAuth codes, tokens, raw cookies, session IDs, or
  state values
- sending browser telemetry to any external origin before a separate privacy,
  CSP, and CORS review

## Evidence Level

Known-supported:

- `@hono/inertia` provides Hono middleware and `c.render(component, props)`.
- The current app already uses `@hono/inertia`.
- The current app already uses `inertia-adapter-solid@1.0.0-beta.3`.
- The Solid adapter exports the Inertia `router`, so client router telemetry is
  possible later.
- Hono has built-in `requestId` middleware via `hono/request-id`.
- `@hono/otel` exists as Hono-maintained OpenTelemetry middleware.
- `@hono/otel` requires a runtime-compatible OpenTelemetry SDK/provider on
  Cloudflare Workers.
- Cloudflare Workers automatic tracing can capture handler, outbound fetch, and
  binding spans.
- Cloudflare Workers can export traces to OpenTelemetry-compatible
  destinations.
- `serviceFetch` already supports trace header injection and event hooks.

Known-limited:

- Cloudflare automatic tracing does not replace app-owned Hono tracing.
- Cloudflare Workers custom spans and attributes remain limited in automatic
  tracing.
- Browser top-level navigation does not carry app-generated trace context before
  JavaScript runs.
- `CF-Ray` availability must be verified in Miniflare.
- Worker OpenTelemetry libraries must be verified against the app's current
  Vite, Wrangler, and Cloudflare compatibility settings.

Needs project spike:

- whether `@hono/otel` plus a Workers-compatible provider works cleanly here
- whether `CF-Ray` is present in Miniflare tests
- whether using `CF-Ray` as `X-Request-Id` has any downstream constraints
- exact shape of shared Hono observability helpers for `apps/inertia` and
  `apps/sheets`
- how API and PostgreSQL spans appear under the Worker-started trace in the
  chosen backend
- whether Cloudflare automatic traces correlate cleanly enough with app-owned
  traces through request ID and Ray ID

## References

- Hono request ID middleware:
  https://www.honojs.com/docs/middleware/builtin/request-id
- Hono middleware guide:
  https://hono.dev/docs/guides/middleware
- Hono third-party middleware repository:
  https://github.com/honojs/middleware
- `@hono/otel`:
  https://www.npmjs.com/package/@hono/otel
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
- `@hono/inertia` npm:
  https://www.npmjs.com/package/@hono/inertia
- `@microlabs/otel-cf-workers`:
  https://www.npmjs.com/package/@microlabs/otel-cf-workers
- Cloudflare Workers traces:
  https://developers.cloudflare.com/workers/observability/traces/
- Cloudflare Workers trace known limitations:
  https://developers.cloudflare.com/workers/observability/traces/known-limitations/
- Cloudflare Workers OTLP export:
  https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/
- Inertia protocol:
  https://inertiajs.com/docs/v3/core-concepts/the-protocol
- Inertia events:
  https://inertiajs.com/docs/v3/advanced/events
- `inertia-adapter-solid`:
  https://github.com/iksaku/inertia-adapter-solid
