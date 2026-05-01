# API Framework Decision

Decision: use Echo for the Go HTTP API.

## Context

The OpenAPI YAML file is the source of truth:

```text
packages/openapi/spec/recurring.openapi.yaml
```

The API should support:

- production request validation against the OpenAPI spec
- handlers registered by OpenAPI `operationId`
- generated Go types from the YAML spec
- test-time response validation against the OpenAPI spec
- central JSON error handling for validation and server errors
- OpenTelemetry instrumentation
- JSON REST endpoints for now

OpenAPI 3.1 support is required. The exact validation engine can be decided
later. Using an existing OpenAPI or JSON Schema library is preferred over
writing a parser and validator from scratch.

## Decision

Use Echo as the HTTP framework.

Echo provides the right framework surface for this project:

- middleware chain for production request validation
- route groups and routing suitable for JSON APIs
- handlers and middleware return `error`
- central `HTTPErrorHandler` for consistent JSON errors
- access to request context for pgx and cancellation
- access to matched route and path parameters for validation glue
- `httptest` compatibility for response validation tests
- OpenTelemetry middleware path through `otelecho`

## Planned Shape

Keep OpenAPI-specific behavior in a small internal package:

```text
apps/api/internal/openapi/
```

Responsibilities:

- load and validate the YAML spec at startup
- index operations by `operationId`
- expose method/path metadata for route registration
- provide request validation middleware
- provide response validation helpers for tests

Keep Echo-specific HTTP wiring in:

```text
apps/api/internal/httpapi/
```

Expected registration style:

```go
api.Handle("createExpense", createExpense)
api.Handle("listExpenses", listExpenses)
```

The registration layer maps operation IDs to Echo routes using the OpenAPI spec.

## Shutdown Requirements

The API must support graceful shutdown because production runs behind a systemd
socket-activated listener.

Shutdown requirements:

- Serve through an explicit `http.Server` so startup and shutdown are owned by
  application code.
- On `SIGTERM`, stop accepting new requests and call `http.Server.Shutdown(ctx)`
  or Echo's shutdown helper with a bounded timeout.
- Pass each request's context into pgx queries and downstream work.
- Avoid `context.Background()` in request-handling paths.
- Close the runtime `pgxpool.Pool` only after the HTTP server has drained or the
  shutdown timeout has expired.
- Keep handlers cancellation-aware so deploy restarts do not wait on abandoned
  database work.
