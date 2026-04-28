# Recommended Observability Stack for Cloudflare Workers

As of April 28, 2026, the recommended production setup for a Cloudflare Worker
that fronts the Recurring web app is:

- Worker tracing: Cloudflare Workers automatic tracing for handler, outbound
  `fetch()`, and supported binding spans
- Worker logs: Workers Logs with structured JSON `console` output
- Worker metrics: Cloudflare Workers metrics and zone analytics for request,
  error, CPU, wall-time, duration, invocation-status, and subrequest views
- telemetry export: Cloudflare OpenTelemetry export for Worker traces and logs
- app trace propagation: explicit W3C `traceparent` and `tracestate`
  forwarding from Worker requests to Recurring API requests
- app correlation: app-owned `request_id`, Cloudflare Ray ID where available,
  route, target service, URL, status, and timestamp
- custom app metrics: backend Prometheus/OpenTelemetry metrics, or Workers
  Analytics Engine for Worker-local product metrics

## Verdict

Cloudflare Workers is stable. The beta label applies to narrower observability
features, especially Workers tracing and OpenTelemetry export behavior, not to
the core Workers runtime.

Workers observability is useful enough for production, but it is not a complete
end-to-end distributed tracing system by itself.

Cloudflare automatic tracing gives Worker-local visibility with no application
SDK:

- Worker invocation spans
- outbound `fetch()` spans
- supported binding spans such as KV, R2, Durable Objects, Queues, Cache, and
  other platform APIs
- CPU time, wall time, colo, Ray ID, outcome, and runtime metadata

The main gaps are still material:

- exported Worker trace IDs are not propagated to external services
- service bindings and Durable Objects can appear as separate traces
- custom application spans and attributes inside Workers are roadmap work
- some non-I/O work can show `0 ms` duration due to runtime timing constraints
- Worker metrics are not exported over OTLP today

So the pragmatic model is:

- use Cloudflare tracing for Worker-local runtime and subrequest timing
- use browser OpenTelemetry for user-visible frontend requests
- use Echo/OpenTelemetry for API and PostgreSQL traces
- manually forward browser-provided `traceparent` through the Worker to the API
- correlate Cloudflare Worker traces/logs with app traces by `request_id`,
  `cf_ray`, route, target URL, status, and timestamp

Do not choose Cloudflare Workers expecting one clean automatic trace from browser
click to PostgreSQL today.

## Runtime Shape

Target request flow:

```text
Browser
  |- document-load span
  |- route/navigation span
  |- same-origin fetch/XHR span with traceparent
Cloudflare Worker
  |- Cloudflare automatic handler span
  |- app/framework route code
  |- Cloudflare automatic outbound fetch span to Recurring API
  |- structured logs with request_id/cf_ray/route/backend fields
Go Echo API
  |- HTTP server span extracted from traceparent
  |- app spans
  |- PostgreSQL client spans
PostgreSQL
  |- DB spans and metrics through API-side instrumentation
```

This gives two useful views:

- app trace view: browser request, API span, domain spans, PostgreSQL spans
- Worker platform view: handler timing, subrequest timing, CPU, wall time, colo,
  Ray ID, runtime outcome, and Worker logs

These views may not share a single trace ID. That is acceptable if the shared
correlation fields are present everywhere.

## Worker Configuration

Enable traces explicitly. Do not rely on generic `observability.enabled` for
traces, because Cloudflare currently documents automatic tracing as early beta
and not enabled by that generic setting.

Recommended `wrangler.toml` shape:

```toml
[observability.traces]
enabled = true
head_sampling_rate = 0.05

[observability.logs]
enabled = true
head_sampling_rate = 0.6
```

If exporting to an external OpenTelemetry destination:

```toml
[observability.traces]
enabled = true
destinations = ["otel-traces"]
head_sampling_rate = 0.05
persist = false

[observability.logs]
enabled = true
destinations = ["otel-logs"]
head_sampling_rate = 0.6
persist = false
```

Use `persist = false` only when the external backend is the source of truth and
Cloudflare dashboard retention is not needed. Otherwise omit it.

Sampling defaults to `1` for tracing when tracing is enabled. Set explicit
sampling rates before production traffic.

## Trace Propagation

Use W3C Trace Context headers.

For same-origin browser fetches:

- browser OpenTelemetry injects `traceparent`
- Worker receives the header
- Worker forwards `traceparent` and `tracestate` to the Recurring API
- Echo middleware extracts the context and continues the app trace
- PostgreSQL spans attach under the API request span

Forward propagation in one shared backend fetch helper, not scattered raw
`fetch()` calls.

Recommended helper behavior:

- copy `traceparent` from the inbound Worker request when present
- copy `tracestate` when present
- add `x-request-id`
- add a safe caller/service marker such as `x-recurring-caller: web-worker`
- record target service, sanitized path, method, status, duration, and retry
  count in structured logs
- never log authorization headers, cookies, OAuth codes, tokens, or API keys

For first HTML document requests:

- browsers usually do not send `traceparent` on top-level navigations
- Cloudflare creates a Worker trace
- browser document-load instrumentation starts after page load begins
- API calls made while rendering initial props may start their own API trace
- correlate initial render work with `request_id`, `cf_ray`, route, backend
  target, and timestamp

A spike can test app-generated `traceparent` for initial render API calls, but
that should not be treated as a complete Worker span until Cloudflare supports
custom Worker spans or automatic trace context propagation.

## Structured Logs

Use structured JSON logs through `console.log()` and `console.error()`.

Base fields:

- `service.name=recurring-web-worker`
- `deployment.environment`
- `event`
- `request_id`
- `cf_ray`
- `traceparent_present`
- `method`
- `route`
- `url.path`
- `status`
- `duration_ms`
- `user_agent.family`
- `auth.state`

Backend call fields:

- `event=worker.backend_fetch`
- `target.service=recurring-api`
- `target.path`
- `method`
- `status`
- `duration_ms`
- `attempt`
- `error.kind`
- `timeout`

Framework-specific fields should be layered on top:

- SolidStart: server function, API route, route wrapper, query/action name
- Inertia: component, response mode, partial reload headers, asset version,
  prop-key count, prop byte size

Avoid logging:

- prop payload values
- request bodies by default
- raw cookies
- session IDs
- OAuth codes
- access or refresh tokens
- API keys
- Google account identifiers unless explicitly hashed or otherwise approved

Workers Logs indexes structured JSON fields, so prefer object logs over string
logs.

## Metrics

Use Cloudflare Workers metrics for platform health:

- request count
- success and error count
- subrequest count
- cached and uncached subrequests
- wall time per execution
- CPU time per execution
- execution duration
- invocation statuses
- request duration when Smart Placement provides it

Use these for runtime and capacity questions:

- Is the Worker erroring?
- Did CPU or wall time jump?
- Are backend subrequests increasing?
- Did a deploy increase exceptions or exceeded-resource outcomes?
- Did a route start waiting on backend I/O?

Do not use Workers metrics as the only product metrics layer. They are Worker
runtime aggregates and are not naturally route, user, tenant, or domain-event
metrics.

For application metrics:

- use API-side Prometheus/OpenTelemetry metrics for backend and PostgreSQL
- use browser Web Vitals and navigation measures for user experience
- use Workers Analytics Engine only if Worker-local high-cardinality product
  analytics are needed

Cloudflare does not currently export Worker metrics over OTLP. Export traces and
logs through Cloudflare OTLP export, and handle metrics separately.

## Logs Export

Use Cloudflare OpenTelemetry export for traces and logs when the target backend
supports OTLP.

Use Workers Logpush when the requirement is raw Workers Trace Event logs in a
storage or log-processing destination. Logpush is useful for archival and
warehouse-style pipelines, but it is not a replacement for app trace propagation.

Use Tail Workers only for specialized filtering, sampling, or transformation
pipelines. It is marked beta and should not be the default production path for
this app.

## Implementation Plan

1. Add explicit Workers observability config to the web Worker deployment.
2. Add a Worker request context helper that creates `request_id`, reads safe
   platform metadata, and exposes sanitized route fields.
3. Centralize all Worker-to-Recurring-API calls in one backend fetch helper.
4. Forward `traceparent`, `tracestate`, and `x-request-id` in that helper.
5. Add structured logs for request start, request finish, backend fetch, and
   error paths.
6. Add framework-specific log fields in the SolidStart or Inertia integration
   layer.
7. Configure Cloudflare OTLP destinations for traces and logs, or keep dashboard
   persistence during the first staging spike.
8. Instrument Echo API with OpenTelemetry extraction, request logs, and
   PostgreSQL spans.
9. Verify browser, Worker, API, and database telemetry in the same backend.
10. Document exact query patterns for correlating Worker traces/logs with API
    traces.

## Acceptance Criteria

- Worker trace shows handler span for a staging request.
- Worker trace shows outbound `fetch()` span to Recurring API.
- Worker logs include `request_id`, route, status, duration, and backend target.
- API receives `traceparent` on browser same-origin fetch/XHR paths.
- Echo trace continues from the forwarded browser trace context.
- Initial HTML path has enough `request_id`/`cf_ray` correlation to join Worker
  logs with API logs manually.
- No browser request goes directly to the Recurring API origin.
- No sensitive OAuth, cookie, session, API key, or prop payload values appear in
  logs.
- OTLP export sends Worker traces and logs to the selected backend, or the spike
  records why dashboard-only storage is being used temporarily.

## Decision Impact

Cloudflare Workers observability does not decide SolidStart versus Inertia by
itself.

Both framework options need the same Worker baseline:

- explicit Worker traces and logs
- structured JSON logging
- centralized backend fetch
- manual trace context forwarding
- request ID correlation
- framework-specific route/component fields

The framework decision should depend on application architecture:

- choose SolidStart if preserving current router, server functions, and app
  shape matters most
- choose Inertia if the desired product protocol is server-owned routing with
  first-response page props and later JSON page visits

Workers observability is strong enough for either, as long as the team accepts
that Cloudflare's automatic Worker trace is currently a platform-local view and
not the parent of the API/PostgreSQL trace in external tools.

## Open Questions

- Can the deployed runtime expose Cloudflare Ray ID directly to app logs, or do
  we rely on Cloudflare telemetry metadata plus app `request_id`?
- Does the chosen frontend runtime make every backend call pass through a single
  helper?
- Which backend is the source of truth for traces and logs: Cloudflare dashboard,
  Grafana/Tempo/Loki, Honeycomb, Sentry, Axiom, or another OTLP destination?
- What production sampling rates keep cost acceptable while preserving enough
  failed and slow requests?
- Should first HTML render API calls generate an app-owned trace context, or
  should they rely only on request ID correlation until Cloudflare custom spans
  mature?

## References

- Cloudflare Workers observability:
  https://developers.cloudflare.com/workers/observability/
- Workers traces:
  https://developers.cloudflare.com/workers/observability/traces/
- Workers tracing known limitations:
  https://developers.cloudflare.com/workers/observability/traces/known-limitations/
- Workers spans and attributes:
  https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/
- Exporting OpenTelemetry data from Workers:
  https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/
- Workers Logs:
  https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Workers Logpush:
  https://developers.cloudflare.com/workers/observability/logs/logpush/
- Workers metrics and analytics:
  https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- Cloudflare Workers platform betas:
  https://developers.cloudflare.com/workers/platform/betas/
