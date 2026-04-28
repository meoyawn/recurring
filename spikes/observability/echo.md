# Recommended Observability Stack for an Echo Service

As of April 11, 2026, the recommended production setup for an Echo service is:

- tracing: OpenTelemetry Go SDK with Echo middleware
- metrics: Echo Prometheus middleware or OpenTelemetry Go metrics
- logs: structured Go logging with Echo request logging
- transport and routing: OpenTelemetry Collector
- metrics backend: Prometheus
- tracing backend: Tempo, Jaeger, Zipkin, or another OTLP-compatible tracing system
- log backend: Loki, Elasticsearch, OpenSearch, or another log store

## Why this split

This split matches the current state of Echo support:

- Echo has a straightforward OpenTelemetry middleware path for HTTP tracing.
- Echo metrics are not backed by a framework-native metrics subsystem like Micrometer in Vert.x.
- Echo logging is still normal application logging through standard Go logging libraries, not an OpenTelemetry-native logging API.

## Recommended architecture

```text
Echo service
  |- tracing: otelecho + OTLP exporter -> OTel Collector -> tracing backend
  |- metrics: echoprometheus or OTel metrics -> /metrics or OTLP -> Prometheus or Collector
  |- logs: slog/zap/zerolog + Echo RequestLogger -> stdout/file -> Collector or log agent -> log backend
```

## Tracing

Use OpenTelemetry middleware in the application.

- add the OpenTelemetry Go SDK
- add Echo OpenTelemetry middleware such as `otelecho`
- configure a tracer provider and OTLP exporter
- export spans to the Collector

This gives you:

- HTTP server spans for Echo routes
- standard trace context propagation across incoming requests
- a clean framework-level entry point for request tracing

Unlike Vert.x, this does not automatically give you framework-aware coverage for everything else in the runtime. You still need separate instrumentation for outbound HTTP calls, database clients, queues, and custom internal spans.

Use auto-instrumentation only when:

- you want the fastest low-code rollout
- you need broader library coverage beyond Echo middleware
- you are willing to verify span quality and avoid overlap with manual instrumentation

## Metrics

Use Prometheus-style HTTP metrics by default.

- add Echo Prometheus middleware
- expose a Prometheus scrape endpoint
- let Prometheus scrape it on an interval

This is the simplest Echo metrics path because it covers the HTTP layer directly, including:

- request counts
- latency
- request size
- response size
- labels such as route, method, host, or status depending on configuration

The main limitation relative to Vert.x is scope. Echo does not have a built-in metrics subsystem that also covers framework internals, message buses, pools, and runtime metrics in one package. If you need runtime and process metrics, add the appropriate Go collectors or OpenTelemetry runtime instrumentation separately.

If your organization standardizes on OpenTelemetry for everything, Echo can support that more naturally than Vert.x. You can use OpenTelemetry Go metrics and pass a meter provider into the Echo instrumentation. Even then, you should think of Echo metrics as HTTP-entry metrics, not broad framework-internal metrics.

## Logging

Use normal Go logging, not an OTel-specific logging API.

- application code logs through `slog`, `zap`, `zerolog`, or another standard Go logger
- request logging is usually done with Echo `RequestLogger`
- add Echo `RequestID` middleware so request IDs are consistently available
- logs include `trace_id`, `span_id`, and `request_id`
- logs are shipped separately to a log backend

Recommended pattern:

- keep logs structured and machine-parsable
- include service name, environment, trace ID, span ID, and request ID
- use `RequestLogger` for HTTP summaries and your application logger for domain events and errors
- ship logs with a Collector or another log forwarder

OpenTelemetry does not replace your application logger in an Echo service. It complements logging by correlating logs with traces.

## Collector placement

The OpenTelemetry Collector should usually sit between the service and the observability backends.

Recommended responsibilities:

- receive pushed traces over OTLP
- optionally receive pushed metrics if you use OTel metrics
- optionally receive or process logs
- batch, enrich, filter, and route telemetry to the final backends

For Prometheus-style metrics, the usual model is still pull-based scraping. That means Prometheus scrapes the app's metrics endpoint directly, or the Collector scrapes it if you choose to centralize scraping there.

## Default recommendation

For most Echo services, choose this:

- tracing: OpenTelemetry Go SDK + `otelecho` + OTLP exporter + OTel Collector
- metrics: Echo Prometheus middleware + Prometheus
- logs: `slog` or `zap` or `zerolog` + Echo `RequestLogger` + trace/span/request IDs

This is the most pragmatic setup because it follows the strongest current support path in each area instead of forcing a single tool to do everything.

## Avoid

- using Prometheus for traces
- assuming Echo tracing middleware also gives you broad runtime or application metrics
- replacing standard Go logging with OpenTelemetry logging APIs in application code
- assuming Echo alone covers outbound client, database, or queue instrumentation
- mixing multiple tracing approaches without checking for duplicate or low-quality spans
