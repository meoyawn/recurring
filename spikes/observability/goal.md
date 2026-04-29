# Observability Goal

Boot the whole system locally, drive it through a browser, and use traces to
explain what happened.

The local stack should let an LLM agent:

- start the app and supporting services from local compose/configuration
- open the web app in a browser
- click through real user flows
- generate distributed traces from those browser actions
- store traces in local trace storage, such as Tempo or Jaeger
- query traces after each browser action
- correlate the clicked UI action with frontend, backend, and database spans
- summarize latency, errors, missing spans, and propagation gaps

Target workflow:

1. Boot local services.
2. Agent opens browser against the local web app.
3. Agent performs a specific click or flow.
4. Browser/frontend/backend/database instrumentation emits telemetry.
5. OpenTelemetry Collector receives, batches, enriches, and forwards telemetry.
6. Tempo or Jaeger persists traces and makes them queryable.
7. Agent queries trace storage for the trace caused by the click.
8. Agent explains what happened across the system.

The important outcome is not only that traces exist. The important outcome is
that a local LLM agent can use traces as feedback after browser interaction and
answer: "what happened because of the click I just made?"
