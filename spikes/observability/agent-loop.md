# Trace Backend Spike

As of April 29, 2026, the trace backend decision should stay between two
single-service candidates:

- Jaeger v2 with Badger storage
- OpenObserve single-node local mode

Do not write off OpenObserve. Its SQL and PromQL query surfaces are materially
useful for LLM agents. Jaeger is still attractive when the agent can get exact
trace IDs from browser responses and only needs trace lookup plus span summary.

## Goal

Choose the local and production trace backend for this workflow:

```text
Playwright launches browser
  -> clicks through the web app
  -> watches document and fetch responses
  -> reads response correlation headers
  -> queries trace backend by trace_id
  -> summarizes frontend, backend, and database spans
  -> optionally correlates compose or journald logs by trace_id/span_id/request_id
```

The backend must work in two places:

- local Docker Compose stack
- production Ubuntu 24 VPS under systemd, colocated with API, sheets, Caddy, and
  Postgres

The VPS constraint matters. The backend should be efficient in CPU, RAM, and
disk, and should not require a heavyweight cluster.

## Key Design Change

The original discovery path was time-window based:

```text
click timestamp -> query traces around that timestamp -> infer which trace belongs to the click
```

The better path is exact trace lookup:

```text
click -> response headers -> trace_id -> backend trace lookup
```

Recommended response headers:

- `x-trace-id`
- `x-span-id`
- `x-request-id`

Optional debug header:

- `traceparent`

Use `traceparent` for request propagation. Use `x-trace-id` as the agent and
human lookup handle.

This weakens the need for SQL as the primary lookup mechanism. It does not
remove SQL's value for fallback queries, missing-span analysis, latency rollups,
and ad hoc agent questions.

## Trace Correlation Attributes

Every first-party span should carry enough metadata for backend queries and
agent summaries.

Core attributes:

- `service.name`
- `deployment.environment`
- `request_id`
- `session.id`
- `app.action.id`
- `app.action.name`
- `app.route.path`
- `http.request.method`
- `http.response.status_code`
- `error.type` when failed

Database spans should include safe database metadata:

- database system
- operation
- table or logical resource when known
- duration
- error status

Do not put secrets, OAuth codes, cookies, tokens, private IPs, or full unsafe
SQL text in span attributes.

`session.id` is currently an OpenTelemetry semantic convention in development,
but it is useful for browser session grouping and should be used intentionally.

## Candidate: Jaeger v2 with Badger

Jaeger v2 is a distributed tracing backend. It can run as one binary or one
container, receive OTLP traces, store traces, expose query APIs, and serve the
Jaeger UI.

Relevant properties:

- single service for local and VPS deployment
- OTLP HTTP ingest on `/v1/traces`
- OTLP gRPC ingest available
- stable query gRPC API on `:16685`
- stable query HTTP JSON API under `/api/v3/*`
- built-in UI on `:16686`
- trace-only backend
- no SQL for traces
- no log storage
- no metric storage by itself
- Badger storage is embedded local filesystem storage
- memory storage exists but is not persistent

Badger is an embedded key-value store used inside the Jaeger binary. It is
similar in role to RocksDB: local disk, no separate server, persistent across
restarts, and single-node only.

Jaeger works best for this agent flow:

```text
trace_id known -> GET trace by ID -> summarize returned spans locally
```

Jaeger is weaker for this agent flow:

```text
unknown trace -> arbitrary SQL-like exploration over spans
```

Jaeger can search traces by service, operation, tags, duration, and time range.
That is enough for fallback lookup when `x-trace-id` is missing, but it is not a
general analytical query engine.

Service Performance Monitoring in Jaeger can use span-derived RED metrics and a
PromQL-compatible metrics backend, but that introduces another storage service.
It should not be part of v1 if the goal is one small trace backend.

### Jaeger Local Shape

Use Badger by default, not memory, unless explicitly doing throwaway tests.

```text
docker compose
  -> jaeger service
  -> Badger data volume
  -> expose UI/query locally
  -> expose OTLP only to local app network
```

Memory storage is acceptable only for throwaway development:

- faster setup
- no disk volume
- traces disappear on restart
- not representative of production persistence

### Jaeger Production Shape

Run Jaeger as one systemd service.

Suggested layout:

- config: `/etc/recurring/jaeger.yaml`
- data: `/var/lib/jaeger`
- user: dedicated unprivileged `jaeger`
- OTLP HTTP: `localhost:4318`
- OTLP gRPC: `localhost:4317` if needed
- query UI/API: loopback, optionally Caddy-proxied behind auth
- retention: start at 48 hours

Local producers on the VPS export directly to loopback. Remote producers should
go through Caddy with an allowlisted OTLP path and an ingestion secret.

## Candidate: OpenObserve

OpenObserve is a single-binary observability platform for traces, logs, metrics,
dashboards, alerts, and RUM.

Relevant properties:

- single-node local mode exists
- local mode uses SQLite metadata and local disk storage by default
- OTLP-native ingestion
- UI included
- traces API exists
- trace data can be queried through search APIs
- logs and traces can use SQL
- metrics can use SQL or PromQL
- broader product surface than Jaeger
- AGPL-3.0 for the open-source edition

OpenObserve works best for this agent flow:

```text
trace_id known -> fetch exact trace
unknown trace -> SQL query over recent spans/logs
agent asks ad hoc questions -> SQL/PromQL against stored telemetry
```

Useful agent questions OpenObserve can answer more naturally than Jaeger:

- find traces for a browser `session.id`
- find spans where `app.action.id` exists but backend span is missing
- group failed spans by route over the last 15 minutes
- find database spans slower than a threshold
- query logs and traces with the same correlation IDs
- query metrics with PromQL when metrics are ingested

OpenObserve is not automatically the right choice. It is a larger system than
Jaeger, even if it is still one service. The AGPL license must be acceptable for
this repo and deployment.

### OpenObserve Local Shape

Use one OpenObserve service in Compose.

```text
docker compose
  -> openobserve service
  -> local data volume
  -> UI/API on local port
  -> OTLP endpoint for app services
```

Use local mode with disk storage. Do not add S3, NATS, or cluster metadata
services for v1.

### OpenObserve Production Shape

Run OpenObserve as one systemd service.

Suggested layout:

- env file: `/etc/recurring/openobserve.env`
- data: `/var/lib/openobserve`
- user: dedicated unprivileged `openobserve`
- UI/API: loopback or Caddy-proxied behind auth
- OTLP ingest: loopback for local producers
- remote ingest: Caddy path allowlist and auth header if needed

OpenObserve can become the single observability UI later if logs and metrics are
intentionally sent there. For v1, it can still be used as trace-first storage.

## Candidate: Tempo with Grafana

Tempo can run in monolithic mode and handle modest trace volumes with local
storage. It is a strong trace backend in the Grafana ecosystem.

For this project, Tempo is not the best first backend because:

- useful human UI normally means Grafana too
- query ergonomics are best in Grafana or TraceQL workflows
- it becomes at least two services for the human-facing path
- the project does not know Grafana yet

Keep Tempo as a later option if the system moves toward Grafana, Loki, and
Prometheus.

## Candidate: Elastic APM

Elastic APM is powerful and worth knowing about, but it is too heavy for this
stage.

Self-managed Elastic APM normally means:

- Elasticsearch
- Kibana
- APM Server, Elastic Agent, or EDOT Collector
- index lifecycle and storage management
- more RAM and operational surface than the current VPS goal wants

It is a good platform when the team wants the Elastic ecosystem. It is not the
right first local trace backend for a 6 GB local budget and one small VPS.

## Collector Placement

Do not require a separate OpenTelemetry Collector for v1.

Both leading candidates can receive OTLP directly:

- Jaeger v2 receives OTLP and internally uses Collector-style pipelines.
- OpenObserve receives OTLP directly.

Add a separate Collector later if these become important:

- centralized redaction
- tail sampling
- multi-backend fanout
- buffering/retry policy independent from backend
- metrics conversion through spanmetrics
- per-source routing

For now, a separate Collector adds another service before there is a clear need.

## LLM Query Interface

The LLM agent should not rely on UI scraping. It should call backend APIs.

For both candidates, v1 agent logic should be:

1. Capture response headers after each Playwright click.
2. Prefer `x-trace-id`.
3. Query exact trace by trace ID.
4. If missing, query by time window plus `session.id` or `app.action.id`.
5. Summarize spans by service, operation, duration, status, and parent-child
   relationship.
6. Read compose logs or journald logs only when the trace indicates an error or
   missing span.

Backend-specific behavior:

- Jaeger: use exact trace lookup first; use service/tag/time search as fallback.
- OpenObserve: use exact trace lookup first; use SQL/search API for fallback and
  analysis.

## RAM And Disk Expectation

With 6 GB available locally, the realistic targets are:

- app services
- Postgres
- one trace backend

Avoid local stacks that add Elasticsearch, Kibana, ClickHouse, Grafana, Loki, or
multiple collectors by default.

Jaeger with Badger should be the smallest trace-only option.

OpenObserve should still be reasonable as one service, but must be measured in
this repo's actual Compose stack because it does more than traces.

Elastic APM and SigNoz-style ClickHouse stacks are not good first fits for this
memory budget.

## Decision Criteria

Run a small proof for both Jaeger and OpenObserve before finalizing.

The proof should answer:

- Can local Compose boot within the 6 GB budget?
- Can Playwright capture `x-trace-id` after a click?
- Can the backend return that exact trace quickly by API?
- Can the agent summarize frontend, Solid server, API, and database spans?
- Can the backend find a trace when response headers are missing?
- Can it filter by `session.id` and `app.action.id`?
- What are idle RAM, click-time RAM, disk growth, and query latency?
- Is the human UI good enough for debugging?
- Is production systemd deployment simple enough?

If Jaeger passes and OpenObserve's SQL does not change the agent workflow much,
choose Jaeger.

If OpenObserve's SQL/search API makes missing-span and fallback analysis much
better without unacceptable resource cost, choose OpenObserve.

## Current Recommendation

Keep two viable tracks:

- minimal trace backend: Jaeger v2 with Badger
- agent-query backend: OpenObserve single-node local mode

Do not choose Elastic APM for v1.

Do not choose Tempo unless the project intentionally adopts Grafana.

Do not add a separate OpenTelemetry Collector until direct-to-backend OTLP
proves insufficient.

The next implementation spike should wire response trace headers first. Once
Playwright can capture `x-trace-id`, run the same browser click against both
Jaeger and OpenObserve and compare agent query ergonomics with real spans.

## Source Notes

Checked April 29, 2026:

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
- OpenTelemetry session semantic conventions:
  https://opentelemetry.io/docs/specs/semconv/general/session/
- Elastic APM with OpenTelemetry:
  https://www.elastic.co/guide/en/apm/guide/current/open-telemetry.html/
- Elastic APM Server setup:
  https://www.elastic.co/docs/solutions/observability/apm/apm-server/setup
