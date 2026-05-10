# Metrics Backend Spike

This spike answers whether Recurring should keep Jaeger for traces and add a
separate metrics backend, or switch to OpenObserve so one local backend can
store traces, metrics, and later logs.

## Success Criteria

Answer these questions:

- can one local OpenObserve service store API traces and API metrics
- can metrics be ingested without adding Prometheus as another local backend
- can Echo/API metrics still expose useful HTTP RED data
- can the design preserve the current `x-trace-id` exact trace lookup workflow
- can the design avoid secrets, cookies, tokens, private IPs, or unsafe SQL text
  in metrics labels and trace attributes
- can the first proof stay local and small enough to replace Jaeger rather than
  add another observability service beside it

## Evidence

OpenObserve is a unified observability backend for logs, metrics, traces, and
frontend monitoring. The project README describes it as an open-source
observability platform for logs, metrics, traces, analytics, and RUM.

OpenObserve metrics ingestion supports:

- Prometheus remote write
- OTLP metrics through the OpenTelemetry Collector
- Telegraf

OpenObserve OTLP ingestion supports logs, metrics, and traces through OTLP HTTP
and OTLP gRPC when using the OpenTelemetry Collector. Its docs show OTLP HTTP
exporters using an OpenObserve organization endpoint, and OTLP gRPC with
organization and stream headers.

OpenObserve Prometheus docs say metrics can be sent through Prometheus remote
write and then explored through SQL or PromQL.

Current repo evidence:

- `apps/api/internal/telemetry/tracing.go` configures OTel tracing only.
- `apps/api/internal/httpapi/tracing.go` emits safe request trace attributes:
  method, route, status, request ID, and error type.
- `spikes/observability/echo.md` says Echo metrics can use either Prometheus
  middleware or OpenTelemetry Go metrics.
- `spikes/observability/sink.md` already leaves metrics path open: Prometheus
  scrape for API and VPS metrics, or OTLP metrics where a subsystem supports it
  cleanly.
- `compose/docker-compose.yml` currently runs Postgres plus Jaeger. Jaeger has
  no metric storage by itself.

## Answer

OpenObserve can be the same backend for metrics and traces.

It fits the specific requirement better than Jaeger when the requirement is:

```text
one local observability backend service
  -> stores traces
  -> stores metrics
  -> can later store logs
  -> offers query/dashboard surface for all three
```

Jaeger remains the smaller trace-first backend, but it does not remove the need
for Prometheus-compatible metric storage later. OpenObserve can remove that
second backend if the API sends metrics over OTLP or if a scraper/Collector
remote-writes Prometheus metrics into OpenObserve.

## Metrics Ingestion Options

Option 1: OpenTelemetry metrics push from `apps/api`.

```text
apps/api
  -> OTel metrics SDK/exporter
  -> OpenObserve OTLP endpoint
  -> OpenObserve metrics storage/query
```

This best satisfies one-backend local development because it does not require a
Prometheus service. It does require API-side metric instruments or middleware
that can use an OTel meter provider.

Option 2: Prometheus scrape plus remote write.

```text
apps/api /metrics
  -> Prometheus or Collector Prometheus receiver
  -> remote write / export
  -> OpenObserve metrics storage/query
```

This is the most conventional HTTP metrics path for Echo and Hono middleware,
but it adds another local collection component. It is still valid if the goal is
one storage backend, not one total observability service.

Option 3: expose `/metrics` only.

This is not enough for OpenObserve by itself. A scrape endpoint needs something
to scrape it and send data onward.

## Recommended Local Proof

If metrics become part of the v1 local backend proof, replace Jaeger with
OpenObserve rather than adding OpenObserve beside Jaeger.

Required proof shape:

```text
GET /healthz
  -> response includes x-trace-id, x-span-id, x-request-id
  -> API exports trace to OpenObserve
  -> API exports one HTTP request metric to OpenObserve
  -> exact trace lookup by x-trace-id succeeds through OpenObserve API
  -> metric query for route=/healthz and status=204 succeeds through OpenObserve
```

Keep labels low-cardinality:

- route
- method
- status code
- service name
- deployment environment

Do not use these as metric labels:

- request ID
- trace ID
- span ID
- user ID
- email
- cookies
- tokens
- raw SQL

Request ID and trace ID belong in traces and structured logs, not metrics
labels.

## Decision

For trace-only v1, Jaeger remains valid and already proven.

For metrics plus traces in one backend, choose OpenObserve and reopen
`spikes/observability/backend.md`.

Recommended next implementation spike:

- replace Jaeger Compose service with OpenObserve single-node local mode
- configure API OTLP trace export to OpenObserve
- add API OTLP metrics export
- prove exact trace lookup by `x-trace-id`
- prove a metrics query for `/healthz`
- record idle memory, disk growth after restart, exposed ports, trace lookup
  latency, and metric query latency

## Success Criteria Status

Answered:

- one local OpenObserve service can store traces and metrics
- metrics can be ingested without Prometheus if API exports OTLP metrics
- Echo/API can still expose useful HTTP RED metrics, either through OTel metrics
  or Prometheus middleware plus a collector/scraper path
- OpenObserve is the better fit than Jaeger if the backend must store metrics
  too

Unresolved until implementation:

- exact OpenObserve single-node Compose service and persistent volume shape
- exact local OTLP trace endpoint and metrics endpoint
- exact OpenObserve trace lookup API call by `x-trace-id`
- exact OpenObserve metrics query API call for route, method, and status
- whether OTel metrics middleware is clean enough for Echo, or whether
  Prometheus middleware plus a Collector receiver is simpler
- local restart persistence proof for both traces and metrics
- local resource measurements and query latency measurements

## Source Notes

- OpenObserve docs: https://openobserve.ai/docs
- OpenObserve metrics ingestion: https://openobserve.ai/docs/ingestion/metrics/
- OpenObserve Prometheus remote write:
  https://openobserve.ai/docs/ingestion/metrics/prometheus/
- OpenObserve OTLP ingestion: https://openobserve.ai/docs/ingestion/logs/otlp/
- OpenObserve repository and license: https://github.com/openobserve/openobserve
