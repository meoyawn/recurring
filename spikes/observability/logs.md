# Logs Backend Spike

This spike chooses the log path for Recurring if OpenObserve becomes the local
and production observability backend for logs, metrics, and traces.

## Success Criteria

Answer these questions:

- can application logs end up in OpenObserve
- can logs correlate with traces by `trace_id` and `span_id`
- should application code emit OTLP logs or structured JSON logs
- can the shape work across Go, TypeScript, Cloudflare Worker runtime logs, and
  later service logs
- can the design avoid coupling application code to OpenObserve-specific log APIs
- can the design avoid secrets, cookies, tokens, private IPs, raw SQL, and
  unsafe high-cardinality fields

## Evidence

OpenObserve supports logs, metrics, and traces in one backend.

OpenObserve trace/log correlation is field based:

- traces use `trace_id` and `span_id`
- log records must include matching `trace_id` and `span_id`
- OpenObserve can map custom log field names in organization parameters
- the UI can navigate from a trace/span to related logs and from a log record to
  the matching trace

OpenObserve log ingestion supports multiple paths:

- OTLP logs at `POST /api/{organization}/v1/logs`
- JSON logs at `POST /api/{organization}/{stream}/_json`
- log forwarders such as OpenTelemetry Collector, Vector, Fluent Bit, Fluentd,
  Filebeat, and language-specific senders

OpenObserve is the backend and an OTLP ingestion target. It is not a full
OpenTelemetry Collector replacement. A Collector or log shipper still matters
when Recurring wants infrastructure-owned collection, batching, transforms,
stdout tailing, redaction, fanout, or retry behavior outside application code.

Current repo evidence:

- `spikes/observability/metrics.md` recommends OpenObserve when one backend must
  store metrics, traces, and later logs.
- `spikes/observability/sink.md` recommends logs carry `trace_id`, `span_id`,
  and `request_id`.
- `spikes/observability/echo.md` recommends normal Go structured logging rather
  than replacing application logging with OpenTelemetry logging APIs.
- `spikes/observability/bun-hono.md` recommends structured JSON logging for Bun
  + Hono, with `trace_id`, `span_id`, and `request_id`.
- `apps/api/internal/httpapi/tracing.go` already records safe trace attributes:
  request ID, method, route, status, and error type.
- `apps/shared-ts/src/hono-tracing.ts` already creates `trace_id`, `span_id`,
  `request_id`, route, method, status, and error context at the Hono middleware
  boundary.

## Answer

Use structured JSON logs at the application boundary.

Do not make first-party application code hand-build OTLP log payloads. Do not
make first-party application code call OpenObserve's `_json` API directly for
ordinary logging.

Recommended ownership split:

```text
Go / TypeScript / Worker app code
  -> structured JSON logs on stdout/stderr
  -> log shipper or Collector owned by deployment
  -> OpenObserve logs stream
```

This is the production-shaped choice because it keeps application logging
language-neutral and keeps OpenObserve credentials, stream routing, retry,
batching, and transforms outside normal request handling.

Between OTLP logs and JSON logs, the answer depends on the boundary:

- application boundary: JSON logs
- ingestion boundary: either JSON ingestion or OTLP logs, chosen by the shipper

If the deployment uses OpenTelemetry Collector for logs, export OTLP logs from
the Collector to OpenObserve. If the deployment uses Vector, Fluent Bit, or a
small local forwarder, sending JSON batches to OpenObserve `_json` is fine.
Application code should not care which backend ingestion API the shipper uses.

## Required Log Fields

Every request-scoped application log should include:

- `level`
- `message`
- `service_name`
- `deployment_environment`
- `trace_id`
- `span_id`
- `request_id`
- `http_request_method` when available
- `http_route` when available
- `http_response_status_code` when available
- `error_type` when failed
- `error_message` when safe

Use `trace_id` and `span_id` exactly unless a local logger strongly prefers
another convention. Exact names avoid OpenObserve organization-parameter
mapping and match OTLP trace fields.

Use `request_id` for fallback search and human debugging. It does not replace
`trace_id`.

## Field Safety

Safe fields:

- trace ID
- span ID
- request ID
- service name
- deployment environment
- route pattern
- HTTP method
- HTTP status
- bounded error type
- safe bounded error message

Unsafe fields:

- cookies
- bearer tokens
- OAuth codes
- session IDs
- emails
- user IDs unless explicitly reviewed
- private IPs
- raw SQL
- request bodies
- response bodies
- full URLs with query strings
- arbitrary headers

Do not use `trace_id`, `span_id`, or `request_id` as metric labels. They belong
in logs and traces, not metrics labels.

## Hono Middleware Implication

`apps/shared-ts/src/hono-tracing.ts` should not learn OpenObserve log ingestion.

It can still improve logging by emitting one structured warning when trace export
fails, using the existing request context:

```json
{
  "level": "warn",
  "message": "OTLP trace export failed",
  "service_name": "recurring-inertia",
  "deployment_environment": "local",
  "trace_id": "00000000000000000000000000000001",
  "span_id": "0000000000000002",
  "request_id": "req-1",
  "http_request_method": "GET",
  "http_route": "/healthz",
  "http_response_status_code": 204,
  "error_type": "Error",
  "error_message": "OTLP trace export failed: 500"
}
```

That warning is useful only after stdout/stderr is shipped into OpenObserve.
Before log shipping exists, it is still a local structured log and a testable
contract for fields.

## Recommended Local Proof

When replacing Jaeger with OpenObserve, prove logs in the same local flow as
traces and metrics:

```text
GET /healthz
  -> response includes x-trace-id, x-span-id, x-request-id
  -> API exports trace to OpenObserve
  -> API writes one structured JSON request or warning log
  -> log shipper sends the log to OpenObserve
  -> OpenObserve trace lookup by x-trace-id succeeds
  -> OpenObserve log query by trace_id returns the matching log
  -> OpenObserve UI can navigate between trace and log
```

Accept either shipper ingestion path for the local proof:

- JSON stdout to shipper to OpenObserve `_json`
- JSON stdout to Collector or agent to OpenObserve OTLP logs

Reject this proof shape:

```text
application code
  -> OpenObserve _json or OTLP logs directly
```

Direct app-to-backend log export makes tests and local proof smaller, but it is
the wrong production boundary for multiple services and runtimes.

## Decision

Choose structured JSON logs from applications, shipped by infrastructure into
OpenObserve.

Use OTLP logs only at the shipper/backend boundary when the deployment already
uses an OpenTelemetry Collector or another agent that can emit OTLP logs cleanly.

Use OpenObserve JSON ingestion at the shipper/backend boundary when that is the
lowest-risk local or production path.

Do not treat OpenObserve as the log shipper. Treat it as the log backend.

## Success Criteria Status

Answered:

- application logs can end up in OpenObserve through JSON ingestion or OTLP logs
- logs can correlate with traces when records include `trace_id` and `span_id`
- application code should emit structured JSON logs, not hand-written OTLP logs
- the shape works across Go, TypeScript, Worker runtime logs, and later services
- backend credentials and stream routing stay out of application logging paths
- `trace_id`, `span_id`, and `request_id` stay out of metric labels

Unresolved until implementation:

- exact local log shipper choice
- exact OpenObserve Compose service and stream names
- exact OpenObserve organization parameter defaults for trace/log field mapping
- whether local proof ships Docker stdout logs through Collector, Vector, or
  Fluent Bit
- exact query API call for finding logs by `trace_id`
- whether request-summary logs are emitted from middleware in every service or
  only error/warning logs at first

## Source Notes

- OpenObserve docs: https://openobserve.ai/docs
- OpenObserve trace/log correlation:
  https://openobserve.ai/docs/user-guide/data-exploration/traces/traces/
- OpenObserve OTLP logs:
  https://openobserve.ai/docs/ingestion/logs/otlp/
- OpenObserve JSON logs:
  https://openobserve.ai/docs/reference/api/ingestion/logs/json/
- OpenObserve ingestion overview:
  https://openobserve.ai/docs/user-guide/ingestion/
