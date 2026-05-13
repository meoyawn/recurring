# API Error Shape Spike

Success criteria:

1. `ValidationErr` in `packages/openapi/spec/recurring.responsible.ts` requires
   `message` and `errors`.
2. Each validation issue is typed with `in`, optional `field`, optional `path`,
   `code`, and `message`.
3. Runtime OpenAPI request-validation 400 responses use that `ValidationErr`
   machine shape.
4. Validation error handling is wired once through
   `echomiddleware.Options.ErrorHandler` in
   `apps/api/internal/httpapi/mux.go`.
5. That handler is scoped to the Echo group created by
   `github.com/responsibleapi/echo-openapi-router` and covers all operations
   mounted by that router builder.
6. `apps/api/internal/apitest/api_test.go` asserts invalid expense creation
   returns field-level body errors with stable `field`, `path`, and `code`.
7. `task check` passes after implementation.

## Context

The OpenAPI spec currently declares a generic 400 response for v1 operations:

```text
packages/openapi/spec/recurring.responsible.ts
```

Current shape:

```ts
const ValidationErr = () =>
  object({
    message: string(),
  })
```

This matches the current runtime body emitted through Echo's default HTTP error
handler, but it is too coarse for form POSTs. The frontend should be able to map
400 responses onto exact form fields.

## Observations

`apps/api/internal/httpapi/mux.go` builds the API router with:

```go
openapirouter.NewRouterBuilder(spec, echomiddleware.Options{...})
```

`github.com/responsibleapi/echo-openapi-router` does not implement validation
itself. It delegates request validation to:

```text
github.com/responsibleapi/echo-middleware
```

`github.com/responsibleapi/echo-openapi-router` mounts an Echo group and adds
middleware to that group in this order:

- root middlewares registered with `RouterBuilder.RootHandler`
- OpenAPI request validation middleware
- route metadata, security, route-specific middlewares, and handlers

This keeps validation handling on the API group created by the router builder.
Routes mounted outside that group keep their own Echo behavior.

`echo-middleware` also exposes an `ErrorHandler` option:

```go
type ErrorHandler func(c *echo.Context, err *echo.HTTPError) error
```

Using this hook keeps the JSON shape tied to validation failures produced by
`echo-middleware`.

Echo v5 `HTTPError` has:

```go
func (he *HTTPError) Unwrap() error
```

`echo-middleware` wraps underlying kin-openapi errors when creating
`*echo.HTTPError`, so application code can inspect the original validation error
with `errors.As`.

Kin-openapi exposes useful structure:

- `openapi3.MultiError` is a list of validation errors.
- `openapi3filter.RequestError` has `Parameter`, `RequestBody`, `Reason`, and
  wrapped `Err`.
- `openapi3.SchemaError` has `JSONPointer() []string`.
- `openapi3filter.ParseError` has `Path() []any`.

`openapi3filter.Options.MultiError = true` is needed if the API should return
multiple validation issues instead of stopping at the first one.

## Current Runtime Shape

Current default response body is:

```json
{ "message": "request body has an error: value is required but missing" }
```

Other upstream examples include:

```json
{"message":"request body has an error: doesn't match schema: property \"invalid\" is unsupported"}
{"message":"Method Not Allowed"}
{"message":"security requirements failed: this check always fails - don't let anyone in!"}
```

The existing `ValidationErr` schema matches this body because it only requires
`message`.

## Contract

Field-level validation should return stable machine-readable issues. The backend
response is a transport contract, not localized UI copy:

```json
{
  "message": "Validation failed",
  "errors": [
    {
      "in": "body",
      "field": "email",
      "path": ["email"],
      "code": "format.email",
      "message": "Invalid email"
    }
  ]
}
```

Suggested OpenAPI schema:

```ts
const ValidationLocation = () =>
  string({
    enum: ["body", "query", "path", "header", "cookie"],
  })

const ValidationIssue = () =>
  object({
    in: ValidationLocation,
    "field?": string(),
    "path?": array(string()),
    code: string(),
    message: string(),
  })

const ValidationErr = () =>
  object({
    message: string(),
    errors: array(ValidationIssue),
  })
```

`field` should be optimized for form libraries. For a simple body field, `field`
should be `email`, not `/email`. For nested values, use dot-separated segments
with numeric indexes, for example `items.0.amount`. Keep `path` as the lossless
segment list.

`code` should be stable enough for frontend translation. First-pass codes can
use normalized OpenAPI and JSON Schema keywords, for example `required`,
`format.email`, `type`, `minimum`, `maximum`, `pattern`, `additionalProperties`,
`parse`, and `invalid`.

I18n is out of scope for the API. `apps/inertia` should translate by `code` and
field context. Backend `message` is an English fallback for logs, debugging, and
non-localized clients.

## Implementation Options

Use `echo-middleware.Options.ErrorHandler` first.

`apps/api/internal/httpapi/mux.go` passes one `echomiddleware.Options` value
into `openapirouter.NewRouterBuilder`. `RouterBuilder.Mount` creates an Echo
group, installs `builder.validationMiddleware(prefix)` on that group, then adds
the generated routes. `echomiddleware.Options.ErrorHandler` therefore covers
validation failures for every operation mounted by that router builder,
including routes registered through `rb.AddRoute(...)`. It does not affect Echo
routes mounted outside that group.

Expected shape:

```go
echomiddleware.Options{
	DoNotValidateServers: true,
	Options: openapi3filter.Options{
		AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		MultiError: true,
	},
	ErrorHandler: validationErrorHandler,
}
```

`validationErrorHandler` should:

- unwrap `*echo.HTTPError`
- flatten `openapi3.MultiError`
- normalize `openapi3filter.RequestError`
- use `RequestError.Parameter` for query, path, header, and cookie fields
- use unwrapped `openapi3.SchemaError.JSONPointer()` for body fields
- use unwrapped `openapi3filter.ParseError.Path()` when available
- return `400` with the chosen `ValidationErr` body for validation failures
- preserve non-400 validation statuses such as 401, 403, 404, and 405 unless a
  broader error-envelope decision changes them

A root middleware wrapper can also work, but `ErrorHandler` is the direct hook
for validation errors from `echo-middleware`.

`apps/api/internal/httpapi/route_expenses.go` should not need route-local
validation logic for OpenAPI shape errors. Invalid `createExpense` payloads
should fail before `CreateExpense` runs.

## I18n

Kin-openapi does not provide a full validation-message i18n catalog.

It does provide:

- `openapi3.SchemaErrorDetailsDisabled = true` to remove schema and value
  details from schema error messages
- `openapi3filter.Options.WithCustomSchemaErrorFunc(...)` to customize schema
  error strings

That is not enough for a complete localized form-error API because it only
covers schema errors. It does not localize every route, parameter, parse, or
security wrapper.

Decision:

- backend returns stable `code`, `in`, `field`, and `path`
- frontend translates by `code` and field context in `apps/inertia`
- backend includes English `message` as a fallback only

## Recommendation

Implement field-level validation JSON in the API first by using
`echo-middleware.Options.ErrorHandler`.

Update `packages/openapi/spec/recurring.responsible.ts` first so `ValidationErr`
is the typed machine contract. Then wire the handler in
`apps/api/internal/httpapi/mux.go`, assert invalid `createExpense` field errors
in `apps/api/internal/apitest/api_test.go`, and run `task check`.

Do not patch `github.com/responsibleapi/echo-openapi-router` or
`github.com/responsibleapi/echo-middleware` for the first pass. First implement
the group-scoped handler through local `mux.go` and verify coverage through API
tests. Patch upstream later only after the local normalized issue shape proves
useful.

If upstreaming, normalize kin-openapi errors inside `echo-middleware` because
that package owns the kin-openapi integration. Then expose a convenience hook in
`echo-openapi-router` so consumers get a Hono-like API.

## Open Questions

- Should `message` be a generic `"Validation failed"` for all 400 validation
  responses, or should it summarize the first issue?
- How much original kin-openapi detail should be included in development logs
  while keeping response bodies safe for user input and secrets?
- Should 401, 403, 404, and 405 responses share the same error envelope as 400
  validation failures?

## Criteria Status

1. Answered by the proposed `ValidationErr` shape with required `errors`.
2. Answered: `code`, `in`, `field`, and `path` are machine fields; i18n belongs
   in `apps/inertia`.
3. Answered by the `ValidationLocation`, `ValidationIssue`, and `ValidationErr`
   schema sketch for `recurring.responsible.ts`.
4. Answered by the Echo group-scoped `echo-middleware.Options.ErrorHandler`
   wiring plan for `mux.go`; no upstream router patch is needed for the first
   pass.
5. Answered as a test requirement: assert invalid `createExpense` payloads
   return field-level 400 issues in `api_test.go`.
6. Unresolved until implementation runs `task check`.

No implementation has been done in this spike.
