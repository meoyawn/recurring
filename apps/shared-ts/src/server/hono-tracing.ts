import type { Context, Env, MiddlewareHandler } from "hono"
import { routePath as honoRoutePath } from "hono/route"

declare module "hono" {
  interface ContextVariableMap {
    recurringTracingRequest: Request
  }
}

type TraceContext = {
  parentSpanID?: string
  sampled: boolean
  spanID: string
  traceID: string
}

type TraceConfig<E extends Env> = {
  fetch?: typeof fetch
  serviceName: string
  traceEndpoint?: string | ((c: Context<E>) => string | undefined)
}

type OtlpAttribute =
  | {
      key: string
      value: { arrayValue: { values: { stringValue: string }[] } }
    }
  | {
      key: string
      value: { intValue: string }
    }
  | {
      key: string
      value: { stringValue: string }
    }

type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  status: {
    code: number
    message?: string
  }
}

const headerTraceparent = "traceparent"
const headerTraceID = "x-trace-id"
const headerSpanID = "x-span-id"
const headerRequestID = "x-request-id"
const headerRequestIDAttribute = "http.request.header.x-request-id"
const traceparentPattern =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const unsafeErrorMessagePattern =
  /\bhttps?:\/\/|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\bbearer\s+|[?&](?:access_token|authorization|code|cookie|refresh_token|session|token)=/i
const zeroTraceID = "00000000000000000000000000000000"
const zeroSpanID = "0000000000000000"
const tracerName = "@recurring/shared-ts/hono-tracing"

const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map(byte => byte.toString(16).padStart(2, "0")).join("")
}

const newSpanID = (): string => randomHex(8)

const newTraceID = (): string => randomHex(16)

const headerValue = (headers: Headers, name: string): string | undefined => {
  const value = headers.get(name)
  return value === null || value === "" ? undefined : value
}

const parseTraceparent = (
  value: string | undefined,
): TraceContext | undefined => {
  const match = value?.match(traceparentPattern)
  if (match === undefined || match === null) {
    return undefined
  }
  const traceID = match[2]
  const parentSpanID = match[3]
  const flags = Number.parseInt(match[4] ?? "00", 16)
  if (
    traceID === undefined ||
    parentSpanID === undefined ||
    traceID === zeroTraceID ||
    parentSpanID === zeroSpanID
  ) {
    return undefined
  }

  return {
    parentSpanID,
    sampled: (flags & 1) === 1,
    spanID: newSpanID(),
    traceID,
  }
}

const requestTraceContext = (request: Request): TraceContext => {
  const extracted = parseTraceparent(
    headerValue(request.headers, headerTraceparent),
  )
  if (extracted !== undefined) {
    return extracted
  }

  return {
    sampled: true,
    spanID: newSpanID(),
    traceID: newTraceID(),
  }
}

const traceparentValue = (context: TraceContext): string =>
  `00-${context.traceID}-${context.spanID}-${context.sampled ? "01" : "00"}`

const generatedRequestID = (request: Request): string =>
  headerValue(request.headers, headerRequestID) ??
  headerValue(request.headers, "cf-ray") ??
  crypto.randomUUID()

const requestWithTraceHeaders = (
  request: Request,
  traceparent: string,
  requestID: string,
): Request => {
  const headers = new Headers(request.headers)
  headers.set(headerTraceparent, traceparent)
  headers.set(headerRequestID, requestID)

  return new Request(request, { headers })
}

const optionValue = <E extends Env>(
  c: Context<E>,
  value: string | ((c: Context<E>) => string | undefined) | undefined,
): string | undefined => (typeof value === "function" ? value(c) : value)

const statusCode = (c: Context): number => {
  if (c.error !== undefined) {
    return c.res.status === 404 ? 404 : 500
  }

  return c.res.status
}

const stringAttribute = (
  key: string,
  value: string | undefined,
): OtlpAttribute[] =>
  value === undefined ? [] : [{ key, value: { stringValue: value } }]

const stringSliceAttribute = (
  key: string,
  values: string[],
): OtlpAttribute => ({
  key,
  value: {
    arrayValue: {
      values: values.map(value => ({ stringValue: value })),
    },
  },
})

const intAttribute = (key: string, value: number): OtlpAttribute => ({
  key,
  value: { intValue: String(value) },
})

const routePath = (c: Context): string => honoRoutePath(c) || c.req.path

const spanName = (c: Context): string => `${c.req.method} ${routePath(c)}`

const unixNanoNow = (): bigint => BigInt(Date.now()) * 1_000_000n

const durationNano = (startedAtMs: number): bigint =>
  BigInt(Math.max(0, Math.round((performance.now() - startedAtMs) * 1_000_000)))

const safeErrorType = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error

const safeErrorMessage = (error: unknown): string => {
  if (
    !(error instanceof Error) ||
    error.message === "" ||
    unsafeErrorMessagePattern.test(error.message)
  ) {
    return "OTLP trace export failed"
  }

  return error.message.slice(0, 256)
}

const otlpSpan = <E extends Env>(
  c: Context<E>,
  context: TraceContext,
  requestID: string,
  startTimeUnixNano: bigint,
  endTimeUnixNano: bigint,
): OtlpSpan => {
  const status = statusCode(c)
  const span: OtlpSpan = {
    traceId: context.traceID,
    spanId: context.spanID,
    name: spanName(c),
    kind: 2,
    startTimeUnixNano: String(startTimeUnixNano),
    endTimeUnixNano: String(endTimeUnixNano),
    attributes: [
      stringSliceAttribute(headerRequestIDAttribute, [requestID]),
      { key: "http.request.method", value: { stringValue: c.req.method } },
      { key: "http.route", value: { stringValue: routePath(c) } },
      intAttribute("http.response.status_code", status),
      ...stringAttribute("error.type", c.error?.name),
    ],
    status:
      c.error === undefined
        ? { code: 0 }
        : { code: 2, message: c.error.message },
  }
  if (context.parentSpanID !== undefined) {
    span.parentSpanId = context.parentSpanID
  }

  return span
}

const otlpPayload = (serviceName: string, span: OtlpSpan): unknown => ({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: serviceName } },
        ],
      },
      scopeSpans: [
        {
          scope: {
            name: tracerName,
          },
          spans: [span],
        },
      ],
    },
  ],
})

const exportSpan = async (
  fetchApi: typeof fetch,
  endpoint: string,
  serviceName: string,
  span: OtlpSpan,
): Promise<void> => {
  const response = await fetchApi(endpoint, {
    body: JSON.stringify(otlpPayload(serviceName, span)),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  if (!response.ok) {
    throw new Error(`OTLP trace export failed: ${response.status}`)
  }
}

const traceExportFailureLog = <E extends Env>(
  c: Context<E>,
  context: TraceContext,
  requestID: string,
  serviceName: string,
  error: unknown,
): Record<string, string | number> => ({
  level: "warn",
  message: "OTLP trace export failed",
  service_name: serviceName,
  trace_id: context.traceID,
  span_id: context.spanID,
  request_id: requestID,
  http_request_method: c.req.method,
  http_route: routePath(c),
  http_response_status_code: statusCode(c),
  error_type: safeErrorType(error),
  error_message: safeErrorMessage(error),
})

export const otlpTraceEndpointFromEnv = (
  env: Record<string, string | undefined>,
): string | undefined => {
  const tracesEndpoint = env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]
  if (tracesEndpoint !== undefined && tracesEndpoint !== "") {
    return tracesEndpoint
  }
  const endpoint = env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  if (endpoint === undefined || endpoint === "") {
    return undefined
  }

  return `${endpoint.replace(/\/$/, "")}/v1/traces`
}

export const tracedRequest = <E extends Env>(c: Context<E>): Request =>
  c.get("recurringTracingRequest") ?? c.req.raw

export const honoTracing = <E extends Env>(
  config: TraceConfig<E>,
): MiddlewareHandler<E> => {
  async function tracingMiddleware(c: Context<E>, next: () => Promise<void>) {
    const startedAtMs = performance.now()
    const startTimeUnixNano = unixNanoNow()
    const context = requestTraceContext(c.req.raw)
    const requestID = generatedRequestID(c.req.raw)
    const traceparent = traceparentValue(context)
    const request = requestWithTraceHeaders(c.req.raw, traceparent, requestID)

    c.set("recurringTracingRequest", request)
    c.header(headerTraceID, context.traceID)
    c.header(headerSpanID, context.spanID)
    c.header(headerRequestID, requestID)

    await next()

    c.header(headerTraceID, context.traceID)
    c.header(headerSpanID, context.spanID)
    c.header(headerRequestID, requestID)

    const endpoint = optionValue(c, config.traceEndpoint)
    if (endpoint === undefined) {
      return
    }

    const endTimeUnixNano = startTimeUnixNano + durationNano(startedAtMs)
    const span = otlpSpan(
      c,
      context,
      requestID,
      startTimeUnixNano,
      endTimeUnixNano,
    )

    try {
      await exportSpan(
        config.fetch ?? fetch,
        endpoint,
        config.serviceName,
        span,
      )
    } catch (error) {
      console.warn(
        JSON.stringify(
          traceExportFailureLog(
            c,
            context,
            requestID,
            config.serviceName,
            error,
          ),
        ),
      )
    }
  }

  return tracingMiddleware
}
