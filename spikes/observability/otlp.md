# OTLP Application Boundary Spike

This spike answers whether Recurring app code should emit backend-neutral OTLP
signals only, with backend-specific logic limited to Compose, deployment, and
test query adapters.

## Success Criteria

Prove whether Recurring app code should emit backend-neutral OTLP signals only,
with backend-specific logic limited to Compose, deployment, and test query
adapters.

## Evidence

OpenTelemetry Protocol exporter configuration is designed for backend-neutral
signal export:

- `OTEL_EXPORTER_OTLP_ENDPOINT` is a base OTLP endpoint.
- OTLP HTTP exporters derive signal paths from that base endpoint.
- traces go to `v1/traces`.
- metrics go to `v1/metrics`.
- logs go to `v1/logs`.
- signal-specific endpoints such as `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` are
  used as-is.
- supported OTLP protocol values include `grpc`, `http/protobuf`, and
  `http/json`.
- OTLP exporter headers can be configured through generic or signal-specific
  OTLP header environment variables.

W3C Trace Context is the propagation boundary:

- `traceparent` carries portable trace identity.
- `tracestate` carries optional vendor-specific trace state.
- trace tools are expected to propagate these headers so traces are not broken.
- services can participate in a trace by extracting incoming context and
  creating child spans.

OpenTelemetry semantic conventions provide the cross-backend event shape:

- `service.name` is required for a service resource.
- `service.version` is recommended and can hold a semantic version, build ID, or
  git hash.
- current semantic conventions use `deployment.environment.name`.
- `deployment.environment` is deprecated and replaced by
  `deployment.environment.name`.
- exceptions use `exception.type`, `exception.message`, and recommended
  `exception.stacktrace`.
- `exception.message` can contain sensitive information and must be bounded or
  filtered by application code.

OpenTelemetry logs can carry trace context directly:

- OTLP log records have top-level `TraceId` and `SpanId` fields.
- non-OTLP JSON logs should use top-level `trace_id` and `span_id`.
- this lets normal structured logs correlate with traces even when logs are
  shipped by infrastructure rather than emitted as OTLP logs from app code.

Current repo evidence:

- `apps/api/internal/telemetry/tracing.go` already configures an OpenTelemetry
  tracer provider and OTLP HTTP trace exporter.
- `apps/api/internal/telemetry/tracing.go` already supports
  `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`.
- `apps/api/internal/httpapi/tracing.go` already extracts inbound trace context,
  creates server spans, records safe HTTP attributes, returns `x-trace-id`,
  `x-span-id`, and `x-request-id`, and records request ID on spans.
- `apps/api/internal/httpapi/tracing.go` calls `span.RecordError(err)`, but does
  not currently request stacktrace capture.
- `apps/shared-ts/src/hono-tracing.ts` manually emits OTLP JSON traces to a
  configured endpoint and is not tied to Jaeger-specific APIs.
- `apps/shared-ts/src/hono-tracing.ts` emits `service.name`,
  `deployment.environment`, request ID, HTTP method, route, status, and
  `error.type` on spans.
- `apps/shared-ts/src/hono-tracing.ts` sets span status error messages, but does
  not currently emit an exception event or log record with
  `exception.stacktrace`.
- `compose/docker-compose.yml` currently chooses Jaeger v2 as the local storage
  backend.
- `apps/inertia/src/miniflare/jaeger.ts` is backend-specific because it queries
  Jaeger `GET /api/v3/traces/{traceID}`. That belongs in test infrastructure,
  not application telemetry emission.

## Answer

Yes. Recurring app code should emit backend-neutral OTLP signals and W3C trace
context only.

Backend-specific logic should stay out of `apps/` request handling and telemetry
emission. The app should know how to create useful spans, logs, metrics, and
exception records. It should not know whether the destination is Jaeger, Tempo,
SigNoz, ClickStack, OpenObserve, Grafana LGTM, or a managed vendor.

Recommended ownership split:

```text
apps/api, apps/inertia, apps/sheets
  -> create spans, logs, metrics, exception records
  -> propagate W3C Trace Context
  -> export OTLP to configured endpoint

compose, deployment, Collector, backend config
  -> choose where OTLP goes
  -> set credentials and headers
  -> batch, redact, sample, route, retry, persist

tests and local agent helpers
  -> query backend-specific read APIs
  -> assert traces/logs/metrics were stored
```

OTLP standardizes ingestion. It does not standardize every backend query API.
Exact trace lookup helpers therefore remain backend adapters.

## Application Contract

Every service should set stable resource attributes:

- `service.name`
- `service.version`
- `deployment.environment.name`

Keep `deployment.environment` only as a temporary compatibility alias if an
existing backend or query still depends on it. New instrumentation should prefer
`deployment.environment.name`.

Every request span should include:

- `request_id`
- `http.request.method`
- `http.route`
- `http.response.status_code`
- `error.type` when failed

Every request-scoped structured log should include:

- `level`
- `message`
- `service_name`
- `service_version`
- `deployment_environment`
- `trace_id`
- `span_id`
- `request_id`

Every captured exception should include:

- `exception.type`
- `exception.message` after safety filtering
- `exception.stacktrace` when available and safe
- active `trace_id`
- active `span_id`
- `service.version`

Metrics should use low-cardinality labels only:

- service
- environment
- route
- method
- status code
- error type when bounded

Metrics must not use:

- trace ID
- span ID
- request ID
- user ID
- email
- cookies
- tokens
- raw SQL
- full URLs

## Endpoint Contract

App code should accept the standard OTLP endpoint configuration:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20...
OTEL_RESOURCE_ATTRIBUTES=service.version=...,deployment.environment.name=local
OTEL_SERVICE_NAME=recurring-api
```

Use the base endpoint when one receiver handles all signals. Use signal-specific
endpoints only when signals are deliberately split.

For `apps/shared-ts`, keep the helper behavior aligned with the OTLP rule:

- `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318` means traces export to
  `http://collector:4318/v1/traces`.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://collector:4318/custom` means use
  that exact URL.

## Backend Boundary

Allowed in `apps/`:

- OpenTelemetry SDKs
- OTLP exporters
- W3C Trace Context propagation
- structured logs with trace correlation fields
- semantic convention attributes
- request correlation headers
- backend-neutral exporter configuration

Not allowed in `apps/` telemetry emission:

- Jaeger query URLs
- Tempo query URLs
- Loki query URLs
- Prometheus query URLs
- ClickHouse SQL for trace lookup
- OpenObserve stream names
- SigNoz exception APIs
- Sentry SDK calls for normal observability
- backend-specific auth headers hard-coded in source

Allowed outside `apps/`:

- `compose/docker-compose.yml` backend choice
- Collector pipelines
- Caddy OTLP ingress rules
- backend credentials from deployment config
- local trace query adapters
- backend-specific smoke tests
- dashboards and saved queries

## Test Adapter Shape

Rename backend-specific helpers by responsibility, not by app concern.

Current shape:

```text
apps/inertia/src/miniflare/jaeger.ts
  -> queries Jaeger directly
```

Better shape:

```text
apps/inertia/src/miniflare/trace-query.ts
  -> exports waitForTrace(traceID)
  -> delegates to backend-specific implementation selected by env/config
```

Possible local adapters:

- Jaeger: `GET http://jaeger.localhost:16686/api/v3/traces/{traceID}`
- Tempo: `GET http://localhost:3200/api/v2/traces/{traceID}`
- Grafana proxy to Tempo:
  `GET http://localhost:3000/api/datasources/proxy/uid/tempo/api/v2/traces/{traceID}`
- OpenObserve, SigNoz, or ClickStack: their own query APIs

The adapter is allowed to be backend-specific because querying is not the OTLP
application boundary.

## Implementation Implications

`apps/api`:

- keep the OpenTelemetry tracer provider.
- add `service.version`.
- migrate resource environment from `deployment.environment` to
  `deployment.environment.name`.
- consider exporting both environment keys temporarily during migration.
- use `span.RecordError(err, trace.WithStackTrace(true))` where exact stacktrace
  capture is required and safe.
- add OTLP metrics only when the app has a stable metric contract.
- keep structured JSON application logs separate from trace export.

`apps/shared-ts`:

- keep OTLP trace export backend-neutral.
- add optional OTLP headers support for deployments that require auth.
- add `service.version`.
- migrate environment resource naming to `deployment.environment.name`.
- emit exception events or OTLP logs with `exception.stacktrace` when errors are
  captured.
- keep structured console logs with `trace_id`, `span_id`, and `request_id`.

`apps/inertia`:

- continue forwarding `traceparent` and `tracestate` to Recurring API calls.
- keep Worker request tracing backend-neutral.
- keep Miniflare trace lookup backend-specific but behind a query adapter.

`apps/sheets`:

- use the same shared TS OTLP behavior as Inertia.
- avoid backend-specific logging or trace APIs.

## Safety Rules

Do not emit these into spans, logs, metrics, or exception messages:

- cookies
- bearer tokens
- OAuth codes
- session IDs
- private IPs
- raw SQL
- request bodies
- response bodies
- full URLs with query strings
- arbitrary request or response headers

Prefer route patterns over paths and URLs. Prefer bounded error type over raw
error string for metrics. Prefer filtered and length-bounded error messages for
logs and exception records.

## Decision

Use pure OTLP and W3C Trace Context in `apps/`.

Keep backend selection in Compose, deployment, Collector/Caddy configuration,
and local query adapters. This makes the app compatible with Jaeger now and
keeps the path open for Grafana LGTM, Tempo, SigNoz, ClickStack, OpenObserve,
or a managed OTLP backend later.

## Success Criteria Status

Answered:

- Recurring app code should emit backend-neutral OTLP signals.
- Recurring app code should use W3C Trace Context for propagation.
- backend-specific ingestion credentials, routing, persistence, and query APIs
  should stay outside normal application telemetry code.
- exact trace lookup helpers must remain backend adapters because OTLP does not
  standardize backend read APIs.
- exact stacktraces require application-side exception capture through
  `exception.stacktrace`; a backend cannot reconstruct missing stackframes.

Unresolved until implementation:

- exact OTLP logs path for first-party apps versus structured JSON stdout plus
  shipper.
- exact OTLP metrics instruments and labels for Echo, Hono, and Workers.
- whether to emit both `deployment.environment` and
  `deployment.environment.name` during migration.
- exact local trace query adapter interface and environment selection.
- exact service version source for local, CI, and production builds.

## Source Notes

- OTLP exporter configuration:
  https://opentelemetry.io/docs/specs/otel/protocol/exporter/
- W3C Trace Context:
  https://www.w3.org/TR/trace-context/
- OpenTelemetry service semantic conventions:
  https://opentelemetry.io/docs/specs/semconv/resource/service/
- OpenTelemetry deployment attributes:
  https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/
- OpenTelemetry exception log conventions:
  https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/
- OpenTelemetry logs data model:
  https://opentelemetry.io/docs/specs/otel/logs/data-model/
- OpenTelemetry trace context fields in non-OTLP logs:
  https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/
