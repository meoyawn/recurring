# Recommended Observability Stack for a Bun + Hono Service

As of April 12, 2026, the recommended production setup for a Bun + Hono service is:

- tracing: OpenTelemetry JS SDK with `@hono/otel`
- metrics: `@hono/prometheus` with `prom-client`, or OpenTelemetry JS metrics if your org standardizes on OTLP metrics
- logs: structured application logging with Hono request logging
- transport and routing: OpenTelemetry Collector
- metrics backend: Prometheus
- tracing backend: Tempo, Jaeger, Zipkin, or another OTLP-compatible tracing system
- log backend: Loki, Elasticsearch, OpenSearch, or another log store

## Why this split

This split matches the current state of Bun + Hono support:

- Hono has official middleware paths for OpenTelemetry, Prometheus metrics, request IDs, logging, and context storage.
- Bun itself exposes lightweight server counters, not a Bun-native observability subsystem comparable to Vert.x Micrometer plus Vert.x tracing.
- OpenTelemetry JavaScript is officially documented for Node.js LTS runtimes, so Bun should be treated as a compatibility target you must verify in your own stack, not as the primary documented runtime.

## Recommended architecture

```text
Bun + Hono service
  |- tracing: @hono/otel + OTel JS SDK + OTLP exporter -> OTel Collector -> tracing backend
  |- metrics: @hono/prometheus + prom-client -> /metrics -> Prometheus scrape
  |- logs: pino/JSON logger + Hono logger/requestId -> stdout -> Collector or log agent -> log backend
```

## Tracing

Use OpenTelemetry in the application, with Hono middleware as the HTTP entry point.

- add `@hono/otel`
- configure an OpenTelemetry SDK and OTLP exporter
- export spans to the Collector
- add manual spans around database calls, queue work, and important domain operations

This gives you:

- HTTP server spans for Hono routes
- standard trace-context handling at the inbound HTTP boundary
- a clean framework-level entry point for request tracing

The main limitation is scope and runtime maturity:

- `@hono/otel` instruments the request-response lifecycle through Hono middleware
- it does not give fine-grained per-middleware spans by default
- it does not automatically give you Bun-aware coverage for every other runtime feature
- OpenTelemetry JS auto-instrumentation is primarily documented for Node.js, not Bun

For most Bun + Hono services, treat tracing as middleware plus explicit instrumentation, not as a fully automatic runtime feature.

## Context propagation

This is the most interesting part of the Bun + Hono story, and the short answer is: yes, request-scoped context propagation is workable, but you should separate two different concerns.

Application context propagation:

- Hono has built-in `contextStorage()` middleware
- Hono documents that this stores the current Hono `Context` in `AsyncLocalStorage`
- Bun documents `AsyncLocalStorage.run()` as making the store available to async operations created inside the callback

So for request-scoped app data such as request ID, tenant, auth context, or current Hono variables, the recommended pattern is:

- install `contextStorage()` near the top of the middleware stack
- use `requestId()` for request correlation
- read request-local data later via `getContext()` or `tryGetContext()`

Trace context propagation:

- inbound propagation is the easy part, because `@hono/otel` handles the Hono request boundary
- outbound propagation is the weak point, because Bun uses its own `fetch` runtime
- OpenTelemetry's browser `fetch` instrumentation explicitly does not instrument Node.js `fetch`
- OpenTelemetry's `undici` instrumentation is specifically for Node.js `undici` and Node global `fetch`

That means you should not assume generic OTel auto-instrumentation will reliably trace and propagate every outbound Bun `fetch()` call.

The pragmatic pattern is:

- use Hono middleware for inbound span creation
- keep request-local data in Hono context storage
- centralize outbound HTTP in a shared `tracedFetch()` helper
- inside that helper, read the current OpenTelemetry context and inject propagation headers before calling Bun `fetch`
- optionally create a client span around the outbound request there as well

So middleware around `fetch` is not really the main solution. A shared outbound HTTP helper is the better solution, because Hono middleware only sees the inbound HTTP lifecycle. Your downstream `fetch()` calls can happen anywhere in the app.

Local validation on Bun 1.3.12 also supports this direction: `AsyncLocalStorage` preserved store values across `await`, `setTimeout()`, and a simple `fetch()` in a local runtime check. That is encouraging, but it is still not the same thing as full first-party Bun-specific OTel instrumentation coverage.

## Metrics

Use Prometheus-style HTTP metrics by default.

- add `@hono/prometheus` and `prom-client`
- expose a Prometheus scrape endpoint
- let Prometheus scrape it on an interval

This is the simplest Bun + Hono metrics path because it gives you practical HTTP RED metrics directly at the framework boundary.

Depending on configuration, this can cover:

- request counts
- request duration
- status codes
- route and method dimensions
- optional default process metrics from `prom-client`

The main limitation relative to Vert.x is scope. Bun's official server metrics are lightweight counters such as pending requests, pending WebSockets, and subscriber counts, not a broad first-party observability system. If you need runtime metrics beyond HTTP entry metrics, add `prom-client` default metrics or OpenTelemetry metrics explicitly.

If your organization standardizes on OpenTelemetry metrics everywhere, you can do that with the JS SDK. The more pragmatic default for Bun + Hono today is still a Prometheus scrape endpoint.

## Logging

Use normal structured application logging, not an OTel-specific logging API.

- application code logs through `pino`, another JSON logger, or disciplined structured `console` output
- request summaries can use Hono `logger()`
- request IDs should come from Hono `requestId()`
- logs include `trace_id`, `span_id`, and `request_id`
- logs are shipped separately to a log backend

Recommended pattern:

- keep logs structured and machine-parsable
- include service name, environment, request ID, trace ID, span ID, route, method, and status
- use request middleware for HTTP summaries and your application logger for business events and errors
- ship logs with a Collector or another log forwarder

OpenTelemetry does not replace your application logger in a Bun + Hono service. It complements logging by correlating logs with traces.

## Collector placement

The OpenTelemetry Collector should usually sit between the service and the observability backends.

Recommended responsibilities:

- receive pushed traces over OTLP
- optionally receive pushed metrics if you use OTel metrics
- optionally receive or process logs
- batch, enrich, filter, and route telemetry to the final backends

For Prometheus-style metrics, the usual model is still pull-based scraping. That means Prometheus scrapes the app's metrics endpoint directly, or the Collector scrapes it if you choose to centralize scraping there.

## Default recommendation

For most Bun + Hono services, choose this:

- tracing: OpenTelemetry JS SDK + `@hono/otel` + OTLP exporter + OTel Collector
- metrics: `@hono/prometheus` + `prom-client` + Prometheus
- logs: structured JSON logger + Hono `requestId()` and `logger()` + trace/span/request IDs

This is the most pragmatic setup because it follows the strongest support path in each area instead of forcing Bun itself to be the observability layer.

## Avoid

- assuming Bun alone gives you a first-party tracing and metrics stack comparable to Vert.x
- assuming Hono tracing middleware also covers outbound `fetch()`, databases, queues, or background jobs automatically
- assuming Node-targeted OTel auto-instrumentation cleanly covers Bun runtime behavior without verification
- scattering raw `fetch()` calls across the codebase if trace propagation matters
- replacing structured application logging with OpenTelemetry logging APIs in application code

## Source notes

This recommendation was checked on April 12, 2026, against:

- Hono Bun docs: https://hono.dev/docs/getting-started/bun
- Hono context storage middleware: https://hono.dev/docs/middleware/builtin/context-storage
- Hono request ID middleware: https://hono.dev/docs/middleware/builtin/request-id
- Hono logger middleware: https://hono.dev/docs/middleware/builtin/logger
- `@hono/otel`: https://www.npmjs.com/package/@hono/otel
- `@hono/prometheus`: https://www.npmjs.com/package/@hono/prometheus
- Bun HTTP metrics docs: https://bun.com/docs/runtime/http/metrics
- Bun `AsyncLocalStorage` reference: https://bun.com/reference/node/async_hooks/AsyncLocalStorage
- OpenTelemetry JS runtime support docs: https://opentelemetry.io/docs/languages/js/
- OpenTelemetry browser `fetch` instrumentation: https://www.npmjs.com/package/@opentelemetry/instrumentation-fetch
- OpenTelemetry `undici` instrumentation package: https://www.npmjs.com/package/@opentelemetry/instrumentation-undici

It also includes a local Bun 1.3.12 runtime check for `AsyncLocalStorage` propagation behavior across `await`, `setTimeout()`, and `fetch()`.
