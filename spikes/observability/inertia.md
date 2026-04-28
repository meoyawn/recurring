# Recommended Observability Stack for Inertia.js on Cloudflare Workers

As of April 28, 2026, the recommended production setup for an Inertia.js app
served by Cloudflare Workers is:

- browser tracing: OpenTelemetry browser SDK with document-load, fetch, XHR, and
  optional user-interaction instrumentation
- Inertia navigation telemetry: small app-owned wrapper around Inertia router
  events for page transition spans and attributes
- Worker tracing: Cloudflare Workers automatic tracing for handler and `fetch()`
  subrequest spans
- Worker logs: structured `console` JSON logs with request ID, Cloudflare Ray
  ID, route, Inertia component, Inertia request mode, and API target
- Hono adapter telemetry: structured logging around `@hono/inertia`
  `c.render(component, props)` calls and response-mode decisions
- shared Hono observability surface with the Bun + Hono `apps/sheets` service:
  request IDs, request-local context, structured log fields, backend fetch
  helpers, trace-context forwarding, and API-call summaries
- API propagation: explicit `traceparent` forwarding from browser Inertia
  requests through Worker API calls
- transport and routing: OpenTelemetry Collector for app-owned browser/API
  telemetry, plus Cloudflare OTLP export for Worker traces and logs
- metrics: Web Vitals and Inertia navigation measures from the browser,
  Cloudflare Worker built-in metrics, API and database metrics from the backend
- tracing backend: Tempo, Jaeger, Honeycomb, Sentry, Axiom, or another
  OTLP-compatible tracing system
- log backend: Loki, Elasticsearch, OpenSearch, or another log store

## Verdict

Inertia is observable enough, but it does not provide an observability adapter
or a tracing model by itself.

That is acceptable for this app because Inertia navigation is plain browser HTTP
plus JSON page objects. Browser OpenTelemetry can instrument the network
requests, and Inertia's router events can add page-level navigation spans.

The frontend adapter story changed on April 28, 2026: Hono now publishes
experimental `@hono/inertia` middleware. That package gives the Worker a
concrete Hono integration point for observability: route handlers call
`c.render(component, props)`, the middleware chooses HTML, Inertia JSON, or
props JSON response mode, and asset-version mismatches return `409` with
`X-Inertia-Location`.

The client adapter choice is also now more concrete. The current app direction
is Solid with the freshest `inertia-adapter-solid` beta, accepting fork
maintenance and upstream contributions if protocol or telemetry gaps appear.
For observability, that means the spike must verify that the Solid adapter
exposes Inertia router lifecycle events, or that the app can wrap
`@inertiajs/core` directly.

This Hono shape also aligns the web Worker with the planned Bun + Hono
`apps/sheets` service. The runtime exporters are different, but a large amount
of app-owned observability code can be shared: request IDs, context helpers,
structured log schemas, backend `tracedFetch()`, trace-context propagation,
and safe API-call summaries.

The blocker is not Inertia. The blocker is the Cloudflare Workers trace context
gap. Cloudflare Workers automatic tracing is useful for Worker-local handler and
subrequest timing, but Cloudflare currently documents that exported Worker trace
IDs are not propagated to other services. It also documents custom spans and
attributes as roadmap work.

So the pragmatic recommendation is:

- use browser OpenTelemetry for user-visible Inertia visits
- enable Cloudflare automatic Worker tracing for Worker-local timing
- forward W3C `traceparent` headers manually from Worker requests to Recurring
  API requests
- instrument the Go Echo API and PostgreSQL normally
- correlate Worker traces with app traces by `request_id`, `cf_ray`, URL, and
  timestamp until Cloudflare trace propagation matures

Do not choose Inertia expecting one clean automatic trace from click to
PostgreSQL through Cloudflare Workers today.

## Runtime Shape

Target request flow:

```text
Browser
  |- document load span
  |- inertia.visit span
  |- fetch/XHR client span with traceparent
Cloudflare Worker
  |- Cloudflare automatic fetch handler span
  |- Hono route handler
  |- @hono/inertia response-mode decision
  |- Cloudflare automatic outbound fetch span to Recurring API
  |- structured logs with request_id/cf_ray/inertia fields
Go Echo API
  |- HTTP server span from traceparent
  |- app spans
  |- PostgreSQL client spans
PostgreSQL
  |- DB spans/metrics through API-side instrumentation
```

This gives two practical views:

- user-facing view: browser route transitions, Inertia requests, API spans, DB
  spans
- Worker-local view: Cloudflare handler timing, subrequest timing, CPU/wall
  time, Cloudflare colo, Ray ID, outcome

The ideal single trace needs Cloudflare to propagate trace context, or the app
to own a Worker-compatible custom tracing layer. Cloudflare's current docs say
automatic cross-service trace propagation is still in progress.

## Browser Tracing

Use browser OpenTelemetry for real user monitoring.

Recommended browser instrumentations:

- `@opentelemetry/sdk-trace-web`
- `@opentelemetry/instrumentation-document-load`
- `@opentelemetry/instrumentation-fetch`
- `@opentelemetry/instrumentation-xml-http-request`
- optionally `@opentelemetry/instrumentation-user-interaction`

Use both fetch and XHR instrumentation. Inertia documents follow-up visits as
XHR-style requests with `X-Inertia: true`; using both avoids coupling telemetry
to the client adapter's internal transport choice.

Browser spans should include:

- `service.name=recurring-web`
- `deployment.environment`
- `app.framework=inertia`
- `app.frontend_adapter=solid-community-beta`
- `app.inertia.component`
- `app.inertia.visit.method`
- `app.inertia.visit.url`
- `app.inertia.partial=true|false`
- `app.inertia.partial.data`
- `app.inertia.asset_version`
- `app.inertia.response_mode=html|json`

Configure fetch/XHR propagation only for allowed origins:

- the same web origin
- any explicitly approved API origin if the browser ever talks to it
- the browser OTLP collector endpoint, if using direct browser OTLP export

For this app's intended shape, browser application traffic should only call the
web origin. The Worker should call the Recurring API server-side.

## Inertia Navigation Spans

Add a small app-owned Inertia telemetry module.

Inertia exposes router lifecycle events such as:

- `start`
- `progress`
- `success`
- `error`
- `httpException`
- `finish`
- `navigate`
- `prefetched`

Use these to create logical route transition spans around Inertia visits.

Recommended span names:

- `inertia.visit GET /dashboard`
- `inertia.form POST /settings`
- `inertia.prefetch GET /items`
- `inertia.reload GET /items`

Recommended attributes:

- `app.inertia.component`
- `app.inertia.target_url`
- `app.inertia.method`
- `app.inertia.completed`
- `app.inertia.cancelled`
- `app.inertia.interrupted`
- `app.inertia.validation_error`
- `app.inertia.http_exception`
- `app.inertia.partial.reload`
- `app.inertia.only`
- `app.inertia.except`
- `app.inertia.prefetch`

This span is not a replacement for HTTP spans. It captures the user-visible page
transition, including client-side work before and after the network request.

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

For Inertia, this means Cloudflare can show that a route handler made a slow API
subrequest, but an external backend may not automatically show that Worker span
as the parent of the Go API span.

## Trace Propagation

Use W3C Trace Context headers.

For Inertia follow-up visits:

- browser fetch/XHR instrumentation injects `traceparent`
- Worker receives `traceparent`
- Worker forwards it when calling the Recurring API
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
- API calls made while rendering initial page props may need a generated request
  ID for correlation

Do not rely on a clean first-load browser-to-Worker trace unless a spike proves
that the Worker can expose or create usable trace context and export matching
spans.

## Initial HTML Props

The first Inertia response includes an HTML shell and a JSON page object. Track
the initial prop-loading path server-side.

Worker logs should include:

- `event=inertia.initial`
- `request_id`
- `cf_ray`
- `method`
- `path`
- `component`
- `asset_version`
- `props.keys`
- `props.bytes`
- `api.calls.count`
- `api.calls.duration_ms`
- `status`

Avoid logging prop values. Props can contain user data.

Browser telemetry should record:

- document load timing
- app boot timing
- first Inertia component name
- page object byte size
- asset version

## Later Inertia Visits

Later visits are easier to observe because they are normal browser HTTP requests
with Inertia headers.

Track these request headers in Worker logs and span attributes where possible:

- `X-Inertia`
- `X-Inertia-Version`
- `X-Inertia-Partial-Component`
- `X-Inertia-Partial-Data`
- `X-Inertia-Partial-Except`
- `X-Inertia-Except-Once-Props`
- `Purpose: prefetch`

Track these response facts:

- status
- `X-Inertia` response header
- `Vary: X-Inertia`
- component
- prop keys
- response bytes
- asset mismatch `409`
- `X-Inertia-Location`
- redirect status
- validation error presence

These fields make Inertia-specific problems debuggable:

- stale assets causing reload loops
- unexpected full reloads
- oversized page props
- slow partial reload props
- form redirects that use the wrong status
- non-Inertia error responses causing `httpException`

## Metrics

Use multiple metric paths.

Browser:

- Web Vitals
- Inertia visit duration
- Inertia request duration
- Inertia error count
- asset mismatch count
- page object byte size
- route/component load count

Worker:

- Cloudflare request count
- error rate
- CPU time
- wall time
- subrequest count
- subrequest duration
- response status
- cache status if static assets are served by Worker

API and database:

- HTTP RED metrics from Echo
- API outbound/internal operation metrics
- PostgreSQL query duration
- PostgreSQL pool wait time
- PostgreSQL error count

Do not expect Inertia itself to expose metrics. Treat it as a source of browser
events and HTTP protocol fields.

## Logging

Use structured logs in the Worker and browser error pipeline.

Worker log fields:

- `service=recurring-web-worker`
- `environment`
- `request_id`
- `cf_ray`
- `traceparent_in`
- `method`
- `path`
- `route`
- `hono.route`
- `inertia.adapter=@hono/inertia`
- `inertia=true|false`
- `inertia_component`
- `inertia_partial`
- `inertia_response_mode=html|page-json|props-json|asset-mismatch`
- `inertia_asset_mismatch`
- `status`
- `duration_ms`
- `api_status`
- `api_duration_ms`

Browser error/event fields:

- `service=recurring-web-browser`
- `session_id` or anonymous stable client ID if allowed
- `request_id`
- `trace_id`
- `url`
- `component`
- `visit_method`
- `visit_status`
- `error_type`
- `asset_version`

Never log cookies, OAuth codes, session IDs, Google OAuth state values, or prop
payloads.

## OAuth Routes

Google OAuth start and callback routes are not Inertia responses, but they still
need telemetry.

Track:

- `/auth/google/start` redirect creation
- OAuth state cookie set result
- `/auth/google/callback` status
- Google token exchange duration and status class
- Recurring API session creation duration and status class
- session cookie set result
- final redirect target path

Do not trace or log:

- authorization code
- access token
- refresh token
- ID token
- client secret
- raw cookie headers

The OAuth callback is a top-level browser navigation, so it has the same
first-load trace limitation as initial Inertia HTML visits.

## Adapter Impact

Observability no longer needs an app-owned adapter as the first option.

The frontend spike now identifies `@hono/inertia` as the preferred adapter
candidate:

- no official Solid client adapter
- current preference is `inertia-adapter-solid@1.0.0-beta.3`
- no official Inertia Cloudflare Workers server adapter in the Inertia docs
- experimental Hono-maintained `@hono/inertia` middleware exists

For observability, the adapter choice mostly changes where hooks are installed:

- React/Vue/Svelte official adapters can use official Inertia router events
- the Solid community beta must expose equivalent lifecycle events or let the
  app wrap the core router directly
- `@hono/inertia` exposes the route-level `c.render(component, props)` boundary
  where component name, prop keys, prop byte size, and backend API summaries can
  be logged before returning the response
- Hono middleware around `@hono/inertia` can record request mode, status,
  response headers, asset mismatch, and redirect decisions

`@hono/inertia` improves observability because it makes the server-side page
boundary explicit. It is still experimental, and the spike should verify that
telemetry code can see component name, visit URL, partial reload headers,
response status, response mode, asset mismatch, and redirect behavior.

## Shared Hono Surface

The Inertia Worker and `apps/sheets` should share Hono observability concepts
where Cloudflare Workers allows it.

Shared code should include:

- request ID creation and propagation
- request-local context shape
- structured log field names
- backend `tracedFetch()` wrapper
- W3C `traceparent` and `tracestate` forwarding
- API-call timing and status summaries
- safe error serialization
- route and target-service naming conventions

Runtime-specific code should stay separate:

- Cloudflare Worker tracing and OTLP export for the web Worker
- OpenTelemetry JS SDK plus `@hono/otel` for the Bun + Hono sheets service
- `@hono/prometheus` and `prom-client` metrics for sheets
- Cloudflare Worker metrics and logs for web

This keeps the shared layer honest. Share app-owned Hono behavior and telemetry
schema, not assumptions that Cloudflare Workers and Bun expose the same
OpenTelemetry runtime.

## Default Recommendation

For an Inertia-on-Workers spike, choose this:

- browser tracing: OpenTelemetry browser SDK with document-load, fetch, XHR, and
  a small Inertia router event bridge
- client adapter: `inertia-adapter-solid@1.0.0-beta.3`, with router event
  verification or a core-router wrapper
- server adapter: Hono plus experimental `@hono/inertia`, with app-owned
  logging middleware around route handlers and responses
- shared Hono observability: reuse request IDs, context helpers, structured log
  fields, backend fetch helpers, and trace propagation with the Bun + Hono
  sheets service
- Worker tracing: Cloudflare automatic tracing and OTLP export
- trace propagation: manually forward incoming `traceparent` from Worker to API
- Worker logs: structured JSON logs with `request_id`, `cf_ray`, Inertia fields,
  and API call summary
- API tracing: OpenTelemetry Go SDK, Echo middleware, outbound/database
  instrumentation, PostgreSQL spans
- metrics: Web Vitals and Inertia navigation metrics in browser, Cloudflare
  Worker metrics, Prometheus/OTel metrics in API and PostgreSQL

This is the most practical setup because it uses stable browser and backend
OpenTelemetry paths while accepting Cloudflare Workers tracing as currently beta
and partly separate.

## Avoid

- assuming Inertia has built-in tracing
- assuming Inertia router events automatically create distributed traces
- assuming `@hono/inertia` logs all useful protocol decisions by itself
- assuming Cloudflare Worker exported traces currently join Go API traces
- logging Inertia prop payloads
- logging OAuth secrets, OAuth codes, tokens, raw cookies, or session IDs
- sending browser telemetry directly to a third-party origin without reviewing
  CSP, CORS, sampling, and privacy rules
- allowing arbitrary trace propagation origins in browser instrumentation
- treating Worker metrics export over OTLP as available today

## Recommended Spike

Build the smallest useful observability spike alongside the Inertia runtime
spike:

- add browser OpenTelemetry setup before the Inertia app boots
- add fetch and XHR instrumentation with propagation limited to the web origin
- add an `inertiaTelemetry` module that listens to router events
- create logical `inertia.visit` spans and navigation metrics
- add Worker request logging around `@hono/inertia`
- factor shared Hono request context, structured log fields, and backend
  `tracedFetch()` so `apps/web` and `apps/sheets` can reuse them where their
  runtimes allow
- log every `c.render(component, props)` route boundary before returning the
  response
- log component, request mode, prop keys, prop byte size, asset version, and API
  call summary
- forward `traceparent` from the incoming Worker request to Recurring API calls
- enable Cloudflare Worker traces and logs in Wrangler
- verify the Go Echo API extracts `traceparent`
- verify PostgreSQL spans attach under the API request span

Acceptance checks:

- first HTML response logs component, prop keys, prop byte size, API duration,
  request ID, and Cloudflare Ray ID
- later Inertia navigation creates browser HTTP spans and an `inertia.visit`
  span
- `@hono/inertia` response modes are observable as
  `html|page-json|props-json|asset-mismatch`
- later Inertia navigation sends `traceparent` to the Worker
- Worker forwards `traceparent` to the Recurring API
- Go API and PostgreSQL spans appear under the browser Inertia request trace
- Worker automatic trace appears in Cloudflare or exported OTLP with handler and
  outbound fetch spans
- Worker trace can be correlated to browser/API trace by request ID, URL,
  timestamp, and Cloudflare Ray ID
- asset version mismatch logs `409` and `X-Inertia-Location`
- partial reload logs requested prop keys and evaluated prop keys
- OAuth callback logs safe status and timing fields without secrets

## Evidence Level

Known-supported:

- Inertia v3 protocol uses first HTML responses with JSON page objects and
  follow-up JSON responses with `X-Inertia: true`.
- Inertia v3 page objects include component, props, URL, version, and optional
  protocol fields.
- Inertia v3 documents request and response headers for partial reloads, asset
  versions, redirects, prefetching, and once props.
- Inertia exposes browser router events that can be used for telemetry hooks.
- `inertia-adapter-solid@1.0.0-beta.3` exists and is the intended Solid adapter
  starting point for the app spike.
- `@hono/inertia` 0.2.0 exists as experimental Hono middleware and provides
  `c.render(component, props)`, `rootView`, `serializePage`, asset version
  mismatch handling, and a Vite page-name generation plugin.
- OpenTelemetry browser SDK supports document-load, fetch, XHR, and
  user-interaction instrumentation.
- OpenTelemetry context propagation uses W3C Trace Context by default.
- Cloudflare Workers automatic tracing covers handler, outbound fetch, and
  binding operations.
- Cloudflare Workers can export traces and logs to OTLP destinations.

Known-limited:

- Cloudflare Workers trace context is not currently propagated to other services
  when exporting traces.
- Cloudflare Workers custom spans and attributes are still documented as future
  work.
- Cloudflare Workers OTLP export does not currently support metrics.
- Browser top-level navigation does not naturally carry a browser-generated
  trace context to the Worker.

Needs project spike:

- whether `inertia-adapter-solid@1.0.0-beta.3` exposes enough router events
- whether `@hono/inertia` exposes enough protocol state directly, or whether
  app-owned Hono middleware must add response-mode logging around it
- how much Hono observability code can be shared with the Bun + Hono sheets
  service without mixing Cloudflare Worker and Bun runtime assumptions
- whether browser fetch/XHR instrumentation catches the exact Inertia transport
- whether partial reloads, validation errors, redirects, and shared props are
  visible enough through `@hono/inertia` plus app code
- whether direct browser OTLP export or a first-party telemetry endpoint is the
  better privacy and CSP fit
- whether Cloudflare's current Worker traces can be correlated cleanly enough
  with backend traces for incidents
- whether first HTML prop-loading should generate synthetic trace context or
  rely on request ID correlation

## References

- Inertia v3 introduction: https://inertiajs.com/docs/v3/getting-started
- Inertia protocol: https://inertiajs.com/docs/v3/core-concepts/the-protocol
- Inertia events: https://inertiajs.com/docs/v3/advanced/events
- Inertia progress indicators: https://inertiajs.com/progress-indicators
- Inertia partial reloads: https://inertiajs.com/partial-reloads
- Inertia asset versioning:
  https://inertiajs.com/docs/v3/advanced/asset-versioning
- `@hono/inertia`:
  https://github.com/honojs/middleware/tree/main/packages/inertia
- `@hono/inertia` npm:
  https://www.npmjs.com/package/@hono/inertia
- `inertia-adapter-solid`:
  https://github.com/iksaku/inertia-adapter-solid
- `inertia-adapter-solid` npm:
  https://www.npmjs.com/package/inertia-adapter-solid
- OpenTelemetry browser docs:
  https://opentelemetry.io/docs/languages/js/getting-started/browser/
- OpenTelemetry context propagation:
  https://opentelemetry.io/docs/concepts/context-propagation/
- OpenTelemetry JS propagation:
  https://opentelemetry.io/docs/languages/js/propagation/
- OpenTelemetry fetch instrumentation:
  https://www.npmjs.com/package/@opentelemetry/instrumentation-fetch
- OpenTelemetry XHR instrumentation:
  https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_instrumentation-xml-http-request.html
- Cloudflare Workers observability:
  https://developers.cloudflare.com/workers/observability/
- Cloudflare Workers traces:
  https://developers.cloudflare.com/workers/observability/traces/
- Cloudflare Workers trace spans and attributes:
  https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/
- Cloudflare Workers trace known limitations:
  https://developers.cloudflare.com/workers/observability/traces/known-limitations/
- Cloudflare Workers OTLP export:
  https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/
