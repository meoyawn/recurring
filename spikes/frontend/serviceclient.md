# Shared TypeScript Service Client

## Success Criteria

- `apps/inertia/src/app/api.ts` uses a shared service client over raw
  `DefaultApi` construction.

## Observations

- `apps/inertia/src/app/api.ts` currently constructs the generated Recurring API
  client directly:

  ```ts
  const api = (bindings: Env): DefaultApi =>
    new DefaultApi(new Configuration({ basePath: apiOrigin(bindings) }))
  ```

- The generated OpenAPI runtime already exposes the extension point needed for
  a wrapper. `apps/inertia/gen/runtime.ts` supports:

  - `ConfigurationParameters.fetchApi`
  - `ConfigurationParameters.middleware`
  - `BaseAPI.withMiddleware()`
  - `BaseAPI.withPreMiddleware()`
  - `BaseAPI.withPostMiddleware()`

- `apps/inertia/src/app/api.ts` imports `DefaultApi`, model types, and
  `Configuration` from generated files. The application-owned surface is small:

  - `apiOrigin(bindings)`
  - `healthCheck(bindings)`
  - `upsertSignup(profile, bindings)`

- `apps/shared-ts` is already a workspace package exported as
  `@recurring/shared-ts`.

- `apps/inertia/package.json` already depends on `@recurring/shared-ts`.

- `apps/sheets/package.json` also already depends on `@recurring/shared-ts`.

- `apps/shared-ts/src/index.ts` currently exports only runtime-neutral helpers:

  - `EmailAddrStr`
  - `isRecord()`

- `apps/api/internal/serviceclient/client.go` is the working Go precedent. It
  centralizes caller-side HTTP behavior:

  - Unix socket dialing when configured
  - retry attempts and backoff
  - idempotency key propagation
  - OpenTelemetry client spans
  - W3C trace context injection through the global propagator

- The TypeScript client should copy the boundary, not the Go implementation.
  Browser, Worker, and Bun tracing exporters differ, but HTTP request policy and
  propagation rules can be shared.

## Decision

Put the TypeScript service client in `apps/shared-ts`.

The package should provide a runtime-neutral fetch wrapper that can be used from
Cloudflare Workers, Bun services, and browser-safe code when appropriate.

The shared client should not import:

- Hono
- Inertia
- Cloudflare-specific modules
- generated OpenAPI clients
- OpenTelemetry SDK exporters

It should expose primitives that app adapters compose with generated clients.

Recommended exported surface:

```ts
export type ServiceClientOptions = {
  fetch?: typeof fetch
  timeoutMs?: number
  maxAttempts?: number
  retryBackoffMs?: number
  headers?: HeadersInit
  context?: ServiceClientContext
  onAttempt?: (event: ServiceClientAttemptEvent) => void
  onResponse?: (event: ServiceClientResponseEvent) => void
  onError?: (event: ServiceClientErrorEvent) => void
}

export type ServiceClientContext = {
  requestID?: string
  traceparent?: string
  tracestate?: string
  idempotencyKey?: string
  retryable?: boolean
}

export const serviceFetch =
  (options: ServiceClientOptions): typeof fetch =>
  async (input, init) => {
    // wrapper implementation
  }
```

`apps/inertia` should own the app-specific adapter:

```ts
const api = (bindings: Env, request: Request): DefaultApi =>
  new DefaultApi(
    new Configuration({
      basePath: apiOrigin(bindings),
      fetchApi: serviceFetch({
        context: serviceClientContextFromRequest(request),
        onResponse: event => {
          // Worker/Inertia logging hook
        },
      }),
    }),
  )
```

The exact `api.ts` function signatures may need to accept request context:

```ts
export const healthCheck = async (
  request: Request,
  bindings: Env,
): Promise<HealthPayload> => {
  await api(bindings, request).healthCheck()
  return { status: "ok" }
}
```

That change is acceptable because Hono route handlers already have `c.req.raw`
and `c.env`.

## Retry Policy

The shared client should retry only safe calls by default:

- `GET`
- `HEAD`
- `OPTIONS`

Unsafe methods should retry only when the caller marks the request retryable and
provides an idempotency key.

Retryable failures:

- network errors
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`

Do not retry arbitrary `4xx` responses.

Request bodies can only be retried when the body can be recreated. In Fetch,
this means the wrapper should create a fresh `Request` for each attempt from the
original input before the body is consumed, or reject retryable streamed bodies
that cannot be replayed.

## Trace And Request Propagation

The shared client should forward these headers when present in
`ServiceClientContext`:

- `traceparent`
- `tracestate`
- `x-request-id`
- `idempotency-key`

It should not generate OpenTelemetry spans directly in v1. Instead it should
emit hook events with timing, attempt number, URL, method, status, and error
facts. Runtime adapters can turn those into:

- Cloudflare Worker structured logs
- Bun service logs
- browser metrics
- OpenTelemetry spans where a runtime-specific SDK is installed

This keeps `@recurring/shared-ts` useful to both `apps/inertia` and
`apps/sheets` without choosing one tracing runtime for every app.

## Inertia Fit

The Inertia Worker should use the shared client at the generated OpenAPI
boundary, not inside page code.

Current call path:

```text
Hono route
  -> healthCheck(c.env)
  -> raw DefaultApi
  -> fetch
```

Recommended call path:

```text
Hono route
  -> healthCheck(c.req.raw, c.env)
  -> DefaultApi with shared serviceFetch
  -> serviceFetch forwards trace/request headers and records attempts
  -> fetch
```

That gives `apps/inertia/src/app/api.ts` one stable API construction point while
keeping route handlers free of generated-client setup.

## Sheets Fit

`apps/sheets` may not need this immediately.

If Sheets later calls the Recurring API or another internal HTTP service, it can
reuse the same `serviceFetch()` and provide Bun/Hono-specific hooks.

This is still a useful package boundary because Sheets should not depend on
Inertia code to get request propagation, retry policy, or idempotency behavior.

## Zero Downtime Scope

The TypeScript service client improves caller behavior during short API
restarts:

- retry idempotent calls
- preserve request and trace context across attempts
- surface clear API timing in logs

It does not replace API process-level zero downtime.

The Go API still needs the `spikes/backend/linux.md` socket activation plan
because only systemd can keep the API listener open across process restarts for
all callers. A TypeScript caller wrapper cannot drain accepted requests, keep
the API socket open, protect direct API callers, or make migrations safe.

## Implementation Sketch

1. Add `apps/shared-ts/src/serviceclient.ts`.
2. Export it from `apps/shared-ts/src/index.ts`.
3. Add focused unit tests for:
   - same-origin headers are preserved
   - `traceparent`, `tracestate`, and `x-request-id` forward from context
   - `GET` retries network errors
   - `POST` does not retry by default
   - retryable `POST` requires idempotency key and replayable body
   - `502`, `503`, and `504` retry
   - hook events include attempt count, status, duration, and errors
4. Update `apps/inertia/src/app/api.ts` to build `DefaultApi` with
   `fetchApi: serviceFetch(...)`.
5. Update `apps/inertia/src/worker.ts` route calls to pass `c.req.raw` where
   needed.
6. Add Miniflare tests proving the Worker forwards incoming `traceparent` and
   `tracestate` to the Recurring API call.

## Unresolved

- Exact hook event shapes should be finalized during implementation.
- Timeout behavior needs one shared convention for caller-provided
  `AbortSignal` plus wrapper timeout.
- Request ID source should be coordinated with the Worker logging middleware so
  the same ID is used for route logs and API calls.
- If browser code uses `serviceFetch()` later, propagation allowlists must avoid
  sending trace headers to arbitrary origins.

## Criteria Status

- `apps/inertia/src/app/api.ts` uses a shared service client over raw
  `DefaultApi` construction: answered at design level. The generated runtime
  already supports `fetchApi`, and `@recurring/shared-ts` is already available
  to `apps/inertia`; implementation remains unresolved.
