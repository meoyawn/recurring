# API Error Shape Spike

Success criteria: document current validation-error research and open questions
for field-level API errors.

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

The router mounts middlewares in this order:

- root middlewares registered with `RouterBuilder.RootHandler`
- OpenAPI request validation middleware
- route metadata, security, route-specific middlewares, and handlers

This means a root middleware can wrap the validation middleware and intercept
validation errors before Echo's global error handler serializes them.

`echo-middleware` also exposes an `ErrorHandler` option:

```go
type ErrorHandler func(c *echo.Context, err *echo.HTTPError) error
```

Using this hook is narrower than a second generic middleware because it only
handles validation failures produced by `echo-middleware`.

Echo v5 `HTTPError` has:

```go
func (he *HTTPError) Unwrap() error
```

`echo-middleware` wraps underlying kin-openapi errors when creating
`*echo.HTTPError`, so application code can inspect the original validation
error with `errors.As`.

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
{"message":"request body has an error: value is required but missing"}
```

Other upstream examples include:

```json
{"message":"request body has an error: doesn't match schema: property \"invalid\" is unsupported"}
{"message":"Method Not Allowed"}
{"message":"security requirements failed: this check always fails - don't let anyone in!"}
```

The existing `ValidationErr` schema matches this body because it only requires
`message`.

## Desired Shape

Field-level validation should return stable machine-readable issues:

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
const ValidationIssue = () =>
  object({
    in: string(),
    "field?": string(),
    "path?": array(string()),
    "code?": string(),
    message: string(),
  })

const ValidationErr = () =>
  object({
    message: string(),
    errors: array(ValidationIssue),
  })
```

`field` should be optimized for form libraries. For a simple body field,
`field` should be `email`, not `/email`. For nested values, use the frontend's
chosen convention, for example `items.0.amount`, while keeping `path` as the
lossless segment list.

## Implementation Options

Use `echo-middleware.Options.ErrorHandler` first.

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

A root middleware wrapper can also work, but it couples error shaping to Echo
middleware ordering. The `ErrorHandler` option is the narrower hook.

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

Preferred contract:

- backend returns stable `code`, `in`, `field`, and `path`
- frontend translates by `code` and field context
- backend includes English `message` as a fallback only

## Recommendation

Implement field-level validation JSON in the API first by using
`echo-middleware.Options.ErrorHandler`.

Do not patch `github.com/responsibleapi/echo-middleware` for the first pass.
Patch upstream later only after the local normalized issue shape proves useful.

If upstreaming, normalize kin-openapi errors inside `echo-middleware` because
that package owns the kin-openapi integration. Then expose a convenience hook in
`echo-openapi-router` so consumers get a Hono-like API.

## Open Questions

- What exact `field` convention should the web frontend use for nested arrays:
  `items.0.amount`, `items[0].amount`, or another form-library-native format?
- Should validation errors for query, path, header, and cookie parameters use
  the same `errors` array as body/form errors?
- Should `message` be a generic `"Validation failed"` for all 400 validation
  responses, or should it summarize the first issue?
- Should backend ever translate validation messages, or should translation live
  exclusively in the frontend?
- Which stable `code` taxonomy should be used for kin-openapi errors:
  OpenAPI/JSON Schema keywords, local application codes, or both?
- How much original kin-openapi detail should be included in development logs
  while keeping response bodies safe for user input and secrets?
- Should 401, 403, 404, and 405 responses share the same error envelope as 400
  validation failures?

## Criteria Status

The criterion is answered. Current research, likely implementation path, and
open questions are captured here.
