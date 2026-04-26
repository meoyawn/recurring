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

OpenAPI 3.1 support is required. The exact validation engine can be decided later.
Using an existing OpenAPI or JSON Schema library is preferred over writing a parser
and validator from scratch.

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

## Eliminated Options

### chi

Good router and middleware model, but weaker fit for this project because it does
not provide a framework-level error and response model. It would require more
custom glue for consistent validation errors.

### Gin

Capable, popular, and testable. Eliminated because the handler and middleware flow
is less clean for this validation pipeline than Echo's `return error` model.

### Fiber

Eliminated because it is built on `fasthttp`. The context and cancellation model is
a weaker fit for pgx-backed request lifecycles.

### Huma

Eliminated because it is OpenAPI-aware but pulls the project toward Go-code-first
API declaration. This project keeps YAML as the source of truth.

### ogen

Strong OpenAPI-generated server option, but eliminated for now because generated
routes and handler contracts are more intrusive than needed. This project wants
generated types, but not necessarily generated routes or typed response unions.

### net/http

Viable, but too bare. Echo gives better ergonomics for middleware, errors, and
JSON API handling without giving up normal Go request contexts.

## Result

Use Echo for the HTTP framework.

Build a small OpenAPI integration layer around it for operation ID routing,
production request validation, and test-time response validation.
