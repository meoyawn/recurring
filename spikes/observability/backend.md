# Trace Backend Spike

This spike chooses the local trace backend for the current repo shape:

- `compose/docker-compose.yml` currently starts only Postgres.
- `apps/api` is the Echo backend that should emit and verify traces first.
- v1 should add exactly one observability backend service beside Postgres.

## Decision

Choose **Jaeger v2 with Badger storage** for v1.

Decision inputs:

- The v1 workflow needs trace-first debugging, not a full observability stack.
- Exact trace lookup by `x-trace-id` is the primary requirement.
- Jaeger v2 can run as one service, receive OTLP directly, persist traces with
  Badger, expose query APIs, and serve the Jaeger UI.
- OpenObserve's AGPL-3.0 license is acceptable for local tooling, but its broader
  logs, metrics, dashboard, alerting, and SQL/search surface is not needed for
  the first proof.
- Keeping v1 trace-only reduces local Compose complexity before the API has
  proven request tracing, headers, and exact lookup.

Do not add OpenObserve for v1. Revisit it only if Jaeger's tag, service,
operation, duration, and time-window search is not enough for API debugging after
trace emission is working.

## Goal

Use this workflow:

```text
Echo API handles request
  -> response includes correlation headers
  -> Jaeger receives OTLP trace data directly from apps/api
  -> exact trace is fetched by x-trace-id through Jaeger API
  -> API spans are summarized by route, operation, duration, status, and errors
```

The first verification target is `GET /healthz` in `apps/api`. The current route
is registered in `apps/api/internal/httpapi/mux.go`, and it is already covered by
API tests in `apps/api/internal/apitest/api_test.go`.

## Constraints

Keep v1 to Postgres plus one Jaeger service.

Do not add:

- a separate OpenTelemetry Collector
- OpenObserve
- Grafana
- ClickHouse
- Elasticsearch
- Loki
- NATS
- S3
- a second Compose file

Jaeger memory storage is acceptable only for throwaway checks. The proof result
must use Badger because restart persistence is a success criterion.

## Required API Headers

`apps/api` should return these headers on traced responses:

- `x-trace-id`
- `x-span-id`
- `x-request-id`

`traceparent` should be accepted on incoming requests and propagated into the
server span. It can also be returned as an optional debug header, but the primary
lookup handle should be `x-trace-id`.

`x-request-id` should preserve an incoming request ID when present. When absent,
the API should generate one. The same value should be returned in the response
header and recorded as the `request_id` span attribute.

Exact trace lookup changes the backend requirement. SQL is useful for fallback
analysis, but the v1 proof should succeed or fail first on direct trace retrieval
by ID.

## Required Span Attributes

Every first-party API span should carry enough metadata for Jaeger queries and
debug summaries.

Core API attributes:

- `service.name=recurring-api`
- `deployment.environment`
- `request_id`
- `http.request.method`
- `http.route`
- `http.response.status_code`
- `error.type` when failed

Database spans should include safe database metadata when API routes touch
Postgres:

- database system
- operation
- table or logical resource when known
- error status

Duration should come from normal span timing rather than a duplicate custom
duration attribute.

Do not put secrets, OAuth codes, cookies, tokens, private IPs, or full unsafe SQL
text in span attributes.

## Current Repo Observations

`compose/docker-compose.yml` currently defines:

- one `postgres` service
- one `recurring_pgdata` volume
- no API service
- no trace backend service
- no observability network or config mounts

`apps/api` currently has:

- Echo setup in `apps/api/internal/httpapi/mux.go`
- `GET /healthz` returning `204 No Content`
- request logging middleware
- OpenAPI request validation middleware
- service-client trace context propagation code under
  `apps/api/internal/serviceclient`
- OpenTelemetry dependencies already present in `apps/api/go.mod`

Unresolved before implementation:

- where API tracer-provider setup should live
- how local API execution will point to Jaeger
- whether `/healthz` should stay `204` or move to `200` for existing tests and
  external probes

## Chosen Backend: Jaeger v2 With Badger

Jaeger v2 is the smallest trace-first option. It can run as one container,
receive OTLP traces, store traces on local disk through Badger, expose query
APIs, and serve the Jaeger UI.

Relevant properties:

- one Compose service
- OTLP HTTP ingest on `/v1/traces`
- OTLP gRPC ingest available if needed
- query gRPC API on `:16685`
- query HTTP JSON API under `/api/v3/*`
- built-in UI on `:16686`
- trace-only backend
- no SQL for traces
- no log storage
- no metric storage by itself
- Badger storage is embedded local filesystem storage
- memory storage exists but is not persistent

Jaeger fits the exact lookup path:

```text
x-trace-id known -> fetch trace by ID -> summarize spans locally
```

Jaeger is weaker for exploratory questions:

```text
unknown trace -> ask arbitrary SQL-like questions over recent spans
```

That tradeoff is acceptable for v1. Jaeger can still search by service,
operation, tags, duration, and time range, which is enough for fallback lookup
after the API returns `x-trace-id` and `x-request-id`.

## Compose Shape

Add one service to `compose/docker-compose.yml`.

Required shape:

- `postgres` remains unchanged except for dependencies only if needed later.
- `jaeger` runs as one service.
- Badger data is stored in a named volume.
- UI/query port is reachable from the host.
- OTLP HTTP is reachable from other Compose services.
- OTLP gRPC is exposed only if the API exporter needs it.

Do not use memory storage for the proof result.

## Rejected For V1

OpenObserve is rejected for v1, despite being viable local tooling.

Evidence and tradeoff:

- OpenObserve single-node local mode exists.
- It can receive OTLP directly.
- It provides a UI and trace APIs.
- It can query logs, traces, and metrics through richer search or SQL-like APIs.
- Its AGPL-3.0 license is acceptable for local tooling.
- Its broader product surface is unnecessary for proving exact API trace lookup.

OpenObserve becomes worth revisiting if v1 needs these questions before adding a
separate analytics backend:

- find recent traces for `GET /healthz`
- group failed API spans by route over the last 15 minutes
- find database spans slower than a threshold
- query logs and traces with the same `trace_id` or `request_id` if logs are
  sent there later
- query metrics with PromQL if metrics are sent there later

Tempo is a strong trace backend in the Grafana ecosystem, but it is not the best
first fit here because useful human debugging normally adds Grafana. That makes
the local proof at least two observability services.

Elastic APM is too heavy for this stage. A self-managed setup normally brings
Elasticsearch, Kibana, APM Server or Elastic Agent, lifecycle management, and
more RAM than the current local proof should spend.

SigNoz-style ClickHouse stacks are also too large for the first proof because
they add another storage service before the API has proven basic trace lookup.

## Collector Placement

Do not require a separate OpenTelemetry Collector for v1.

Jaeger v2 receives OTLP directly and internally uses Collector-style pipelines.

Add a separate Collector later only if these become important:

- centralized redaction
- tail sampling
- multi-backend fanout
- buffering and retry policy independent from backend
- metrics conversion through spanmetrics
- per-source routing

For this proof, a Collector adds another service before there is a clear need.

## Implementation Plan

Phase 1 is Jaeger boot:

- `docker compose` starts Postgres plus Jaeger.
- Jaeger uses Badger storage through a persistent named volume.
- OTLP HTTP ingest is reachable from other Compose services.
- Jaeger UI or query API is reachable from the host.
- Restart keeps already-ingested traces.
- Idle RAM, disk growth after restart, and exposed ports are recorded.

Phase 2 is API instrumentation:

- `apps/api` configures an OpenTelemetry tracer provider.
- `apps/api` exports OTLP directly to Jaeger.
- Echo middleware creates one server span for `GET /healthz`.
- The server span has `service.name=recurring-api`.
- Incoming `traceparent` is accepted.
- `/healthz` remains `204 No Content`.
- `/healthz` response includes non-empty `x-trace-id`, `x-span-id`, and
  `x-request-id`.
- Incoming `x-request-id` is preserved in the response header and `request_id`
  span attribute.
- Missing `x-request-id` gets a generated response header value and matching
  `request_id` span attribute.
- Span attributes include safe method, route, status, and error data.
- Span duration is available from normal span timing.
- Span attributes do not include secrets, cookies, tokens, private IPs, or
  unsafe SQL text.

Phase 3 is exact trace lookup:

- A request to `GET /healthz` captures `x-trace-id`.
- Jaeger returns the exact `/healthz` trace by API without UI scraping or
  fallback search.
- The returned trace includes the expected API server span.
- Exact-trace query latency is recorded.

Fallback lookup by time window, service, route, status, or `request_id` can be
recorded as an observation if useful, but it is not required for v1 success. The
Jaeger UI is for human debugging and is not an automated success criterion.

## Success Criteria Status

Answered:

- backend choice: Jaeger v2 with Badger
- one-service observability constraint: keep only Jaeger beside Postgres
- OpenObserve license concern: acceptable locally, but not needed for v1
- collector placement: no separate Collector for v1

Unresolved until implementation:

- exact Jaeger v2 Compose command and Badger config path
- host and Compose-network OTLP endpoint values for `apps/api`
- tracer-provider package location in `apps/api`
- exact Jaeger API call for trace lookup by `x-trace-id`
- resource measurements for idle RAM, restart disk growth, and lookup latency

A candidate implementation fails if Jaeger needs another storage service or
observability UI service, cannot return an exact `/healthz` trace by API, cannot
persist traces across restart, or cannot fit locally beside Postgres and the API.

## Source Notes

Existing notes were based on these sources:

- Jaeger v2 APIs: https://www.jaegertracing.io/docs/2.17/architecture/apis/
- Jaeger Badger storage: https://www.jaegertracing.io/docs/2.17/storage/badger/
- Jaeger Badger config sample:
  https://github.com/jaegertracing/jaeger/blob/v2.17.0/cmd/jaeger/config-badger.yaml
- Jaeger deployment/configuration:
  https://www.jaegertracing.io/docs/2.17/deployment/configuration/
- OpenObserve architecture: https://openobserve.ai/docs/architecture/
- OpenObserve environment variables:
  https://openobserve.ai/docs/administration/configuration/environment-variables/
- OpenObserve trace API:
  https://openobserve.ai/docs/reference/api/traces/trace-search-api/
- OpenObserve license: https://github.com/openobserve/openobserve
- Elastic APM with OpenTelemetry:
  https://www.elastic.co/guide/en/apm/guide/current/open-telemetry.html/
- Elastic APM Server setup:
  https://www.elastic.co/docs/solutions/observability/apm/apm-server/setup
