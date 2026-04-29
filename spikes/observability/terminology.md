# Observability Terminology

- **Span**: one timed unit of work inside a trace, such as a request handler,
  fetch, or database query.
- **E2E trace**: one end-to-end request story made from spans across browser,
  Solid, API, and database work.
- **OTLP HTTP**: OpenTelemetry Protocol over HTTP, usually sent to an OTLP
  receiver over HTTP.
- **OTLP HTTP exporter**: SDK component that sends finished spans, logs, or
  metrics to an OTLP HTTP receiver.
- **OTLP receiver**: Collector component endpoint that accepts OTLP telemetry
  from exporters. It is part of the OpenTelemetry Collector, while the Collector
  also runs the processing and forwarding pipeline around that receiver.
- **OpenTelemetry Collector**: telemetry pipeline service that receives,
  batches, enriches, filters, and forwards telemetry to backends.
- **Trace storage**: backend service that persists traces for query and
  retention, such as Tempo, Jaeger, Zipkin, or a vendor tracing backend. This is
  separate from the OpenTelemetry Collector, which may buffer telemetry for
  reliable delivery but does not usually provide queryable trace retention.

## Request Headers

- **`traceparent` header**: W3C HTTP header that carries trace ID, parent span
  ID, and trace flags to the next service.
- **`tracestate` header**: W3C HTTP header that carries vendor-specific trace
  context for the same trace.
- **`baggage` header**: W3C HTTP header that carries cross-service key-value
  context attached to telemetry.
