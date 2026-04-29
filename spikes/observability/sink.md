# Recommended Observability Sink

As of April 29, 2026, the recommended telemetry sink for Recurring is an
OpenTelemetry Collector on the same VPS as `apps/api`, exposed to remote
producers through Caddy and kept private for local producers.

Use `sink.md` rather than `collector.md` because the concern is larger than one
Collector config. It includes where telemetry enters, how it is secured, which
systems export to it, and which backend stores ultimately hold traces and logs.

## Terminology

Services do not push complete traces.

Services create spans and export them. A trace is the set of spans sharing one
trace ID. End-to-end traces only join cleanly when upstream services propagate
W3C Trace Context on outbound requests and downstream services extract it.

Practical wording:

- apps create spans
- apps export spans over OTLP
- Collector receives spans
- Collector batches, enriches, samples, and routes spans
- trace backend stores spans and shows them as traces by trace ID
- logs are exported or shipped separately, but should carry `trace_id`,
  `span_id`, and `request_id`
- metrics are either pushed over OTLP or scraped, depending on subsystem

The Collector can help route and process telemetry. It is not the thing that
magically glues unrelated spans together. The glue is shared `trace_id` plus
parent/span relationships from request propagation.

## Verdict

Run one OpenTelemetry Collector next to `apps/api` on the VPS.

Default shape:

```text
Browser
  -> same-origin Solid telemetry proxy
  -> Caddy protected OTLP endpoint
  -> OTel Collector
  -> trace/log backends

Solid server runtime
  -> Caddy protected OTLP endpoint, or loopback if colocated
  -> OTel Collector
  -> trace/log backends

Cloudflare Workers platform export
  -> Caddy protected OTLP endpoint
  -> OTel Collector
  -> trace/log backends

apps/api on VPS
  -> 127.0.0.1:4318
  -> OTel Collector
  -> trace/log backends

apps/sheets if deployed on VPS
  -> 127.0.0.1:4318
  -> OTel Collector
  -> trace/log backends
```

Keep the Collector receiver itself off the public internet. Caddy is the public
ingress boundary.

## Collector Placement

Preferred placement:

- same VPS as `apps/api`
- Collector OTLP HTTP receiver bound to `127.0.0.1:4318`
- optional OTLP gRPC receiver bound to `127.0.0.1:4317`
- Caddy exposes only selected HTTPS paths for remote producers
- Caddy requires a secret header for server-side producers
- Caddy forwards accepted OTLP traffic to loopback Collector receiver

This keeps local API export simple and avoids exposing the raw Collector
receiver.

## Public Ingestion

Expose only OTLP HTTP paths through Caddy:

- `/v1/traces`
- `/v1/logs`
- optionally `/v1/metrics` if remote OTLP metrics are used

Do not expose:

- Collector health/debug endpoints
- pprof/zpages
- arbitrary Collector ports
- unauthenticated OTLP receiver

Recommended Caddy behavior:

- terminate TLS
- accept only OTLP paths
- require an ingestion secret header for trusted server-side exporters
- reject unknown paths
- cap request body size
- forward to `127.0.0.1:4318`
- log request ID, status, path, and upstream duration
- never log ingestion secret values

## Browser Telemetry

Browser code cannot hold Collector credentials.

Default browser path:

```text
Browser OTel exporter
  -> same-origin Solid telemetry route
  -> server-side secret added by Solid runtime
  -> Caddy protected OTLP endpoint
  -> Collector
```

The Solid telemetry route should be a separate spike because it needs browser
abuse controls:

- no long-lived secret in client code
- same-origin only
- CORS locked down or avoided
- body size limit
- rate limit
- sampling
- recursive tracing avoidance for the telemetry endpoint itself
- no cookie/session leakage into telemetry payload logs

Until this exists, browser tracing can still record locally for development or
be disabled in production.

## Solid Server Runtime

For Node.js on the VPS:

- export spans to `http://127.0.0.1:4318/v1/traces`
- export logs to `http://127.0.0.1:4318/v1/logs` if using OTLP logs
- no Caddy hop needed

For Cloudflare Workers or another remote runtime:

- export app-owned Solid spans to Caddy HTTPS OTLP endpoint
- include ingestion secret from Worker/server environment
- keep browser export separate from Worker/server export

Solid server spans should include:

- `service.name=recurring-web`
- `deployment.environment`
- `app.framework=solidstart`
- `app.runtime=node|cloudflare-workers`
- `request_id`
- `cf_ray` when present
- `trace_id`
- `span_id`

## Cloudflare Workers Platform Export

Cloudflare Workers automatic observability can export traces and logs to an
OpenTelemetry destination.

Use it as supplemental runtime evidence:

- Worker handler spans
- outbound `fetch()` spans
- supported binding spans
- Worker logs

Do not depend on Cloudflare platform traces as the primary end-to-end trace
source. App-owned propagation from Solid server to Recurring API remains the
correctness path.

Destination shape:

```text
Cloudflare Workers OTLP export
  -> https://otel.recurring.example/v1/traces
  -> Caddy secret check
  -> Collector
```

Use real hostname and secret from deployment configuration, not the repository.

## Recurring API

`apps/api` should export directly to loopback Collector.

Recommended path:

```text
apps/api
  -> OTLP HTTP 127.0.0.1:4318
  -> Collector
  -> trace backend
```

The API should:

- use Echo OpenTelemetry middleware
- extract inbound `traceparent` and `tracestate`
- create HTTP server spans
- instrument outbound HTTP clients if any
- instrument PostgreSQL client calls
- include `trace_id`, `span_id`, and `request_id` in structured logs

PostgreSQL does not need to export spans itself for the first version. API-side
database instrumentation creates the DB spans.

## Sheets Service

If `apps/sheets` runs on the same VPS, use loopback Collector export.

If it runs remotely, use the Caddy HTTPS OTLP endpoint with server-side
ingestion secret.

It should follow the same propagation rule:

- extract `traceparent` on inbound requests
- inject `traceparent` on outbound calls
- include `trace_id`, `span_id`, and `request_id` in logs

## Trace Propagation

Use W3C Trace Context everywhere.

Required request headers:

- `traceparent`
- `tracestate` when present

Optional correlation headers:

- `baggage` if intentionally used and scrubbed
- `x-request-id`
- `cf-ray` from Cloudflare, read-only

Response headers are not required for distributed trace propagation. They are
only useful for diagnostics and browser/server correlation.

Useful optional response headers:

- `x-request-id`
- `server-timing`
- a debug-only trace ID header if explicitly accepted

## Security

Never commit ingestion secrets, host IPs, or private backend URLs.

Remote OTLP ingestion should require:

- HTTPS
- secret header for server-side producers
- body size limits
- path allowlist
- rate limits where possible
- no public Collector admin/debug endpoints

Browser telemetry must not use the same secret path directly. Use a same-origin
proxy or keep browser export disabled until the proxy is designed.

## Sampling

Start with conservative head sampling for remote high-volume sources and full
sampling for low-volume local development.

Recommended first production defaults:

- browser: disabled until proxy exists, then low sample rate
- Cloudflare Worker platform traces: low sample rate
- Solid server app spans: moderate sample rate
- API spans: moderate sample rate
- errors: keep when possible

Tail sampling can move into the Collector later when traffic volume justifies
it. Until then, keep sampling simple and explicit per producer.

## Backends

The Collector should export traces to one trace backend:

- Tempo
- Jaeger
- Honeycomb
- Sentry
- Axiom
- another OTLP-compatible backend

Logs should go to one log backend:

- Loki
- Elasticsearch
- OpenSearch
- Axiom
- another structured log store

Metrics can be separate:

- Prometheus scrape for API and VPS metrics
- OTLP metrics only where a subsystem already supports it cleanly

Avoid choosing the backend inside application code. Application code should know
only the OTLP endpoint and resource attributes.

## Minimal Collector Pipeline

First version:

```text
receivers:
  otlp/http on 127.0.0.1:4318

processors:
  memory_limiter
  resource
  batch

exporters:
  trace backend
  log backend

pipelines:
  traces: otlp -> processors -> trace backend
  logs: otlp -> processors -> log backend
```

Later additions:

- tail sampling
- attribute redaction
- span filtering
- Prometheus receiver
- separate pipelines per environment
- dead-letter or debug exporter during rollout

## Open Questions

- final trace backend
- final log backend
- public OTLP hostname
- Caddy secret header name
- browser telemetry proxy design
- sampling rates per environment
- whether `apps/sheets` runs on the VPS or remotely
- whether metrics use Prometheus scrape only or mixed Prometheus plus OTLP

## Recommended Next Spike

Create a browser telemetry proxy spike for `apps/web`.

It should answer:

- where browser OTLP payloads are accepted
- how recursion is avoided
- how request body size and rate are limited
- how sampling is configured
- whether unauthenticated browser telemetry is accepted at all
- how `server-timing`, `x-request-id`, and trace IDs are exposed safely
