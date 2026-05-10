import { httpInstrumentationMiddleware } from "@hono/otel"
import type {
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanContext,
  SpanOptions,
  SpanStatus,
  TimeInput,
  Tracer,
} from "@opentelemetry/api"
import type { Context, Env, MiddlewareHandler } from "hono"

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
  deploymentEnvironment?: string | ((c: Context<E>) => string | undefined)
  fetch?: typeof fetch
  serviceName: string
  traceEndpoint?: string | ((c: Context<E>) => string | undefined)
}

type OtlpAnyValue =
  | {
      arrayValue: { values: OtlpAnyValue[] }
    }
  | {
      boolValue: boolean
    }
  | {
      doubleValue: number
    }
  | {
      intValue: string
    }
  | {
      stringValue: string
    }

type OtlpAttribute = {
  key: string
  value: OtlpAnyValue
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
const traceparentPattern =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const zeroTraceID = "00000000000000000000000000000000"
const zeroSpanID = "0000000000000000"

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

const stringAttribute = (
  key: string,
  value: string | undefined,
): OtlpAttribute[] =>
  value === undefined ? [] : [{ key, value: { stringValue: value } }]

const routePath = (c: Context): string => c.req.routePath || c.req.path

const unixNanoNow = (): bigint => BigInt(Date.now()) * 1_000_000n

const unixNanoFromTimeInput = (time: TimeInput | undefined): bigint => {
  if (time === undefined) {
    return unixNanoNow()
  }
  if (time instanceof Date) {
    return BigInt(time.getTime()) * 1_000_000n
  }
  if (typeof time === "number") {
    return BigInt(Math.round(time * 1_000_000))
  }

  return BigInt(time[0]) * 1_000_000_000n + BigInt(time[1])
}

const otlpPayload = (
  serviceName: string,
  deploymentEnvironment: string | undefined,
  span: OtlpSpan,
): unknown => ({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: serviceName } },
          ...stringAttribute("deployment.environment", deploymentEnvironment),
        ],
      },
      scopeSpans: [
        {
          scope: {
            name: "@hono/otel",
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
  deploymentEnvironment: string | undefined,
  span: OtlpSpan,
): Promise<void> => {
  const response = await fetchApi(endpoint, {
    body: JSON.stringify(otlpPayload(serviceName, deploymentEnvironment, span)),
    headers: { "content-type": "application/json" },
    method: "POST",
  })
  if (!response.ok) {
    throw new Error(`OTLP trace export failed: ${response.status}`)
  }
}

const otlpAnyValue = (
  value: SpanAttributeValue | null | undefined,
): OtlpAnyValue | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === "string") {
    return { stringValue: value }
  }
  if (typeof value === "boolean") {
    return { boolValue: value }
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value }
  }

  return {
    arrayValue: {
      values: value.flatMap(item => {
        const converted = otlpAnyValue(item)
        return converted === undefined ? [] : [converted]
      }),
    },
  }
}

const otlpAttributes = (attributes: SpanAttributes): OtlpAttribute[] =>
  Object.entries(attributes).flatMap(([key, value]) => {
    const converted = otlpAnyValue(value)
    return converted === undefined ? [] : [{ key, value: converted }]
  })

class ExportedSpan implements Span {
  #attributes: SpanAttributes
  #context: TraceContext
  #deploymentEnvironment: string | undefined
  #endpoint: string
  #fetchApi: typeof fetch
  #name: string
  #requestID: string
  #serviceName: string
  #exportPromise: Promise<void> | undefined
  #startTimeUnixNano: bigint
  #status: SpanStatus = { code: 0 }

  constructor(
    name: string,
    context: TraceContext,
    requestID: string,
    endpoint: string,
    serviceName: string,
    deploymentEnvironment: string | undefined,
    fetchApi: typeof fetch,
    options: SpanOptions | undefined,
  ) {
    this.#attributes = {
      ...options?.attributes,
      request_id: requestID,
      "deployment.environment": deploymentEnvironment,
    }
    this.#context = context
    this.#deploymentEnvironment = deploymentEnvironment
    this.#endpoint = endpoint
    this.#fetchApi = fetchApi
    this.#name = name
    this.#requestID = requestID
    this.#serviceName = serviceName
    this.#startTimeUnixNano = unixNanoFromTimeInput(options?.startTime)
  }

  addEvent(): this {
    return this
  }

  addLink(): this {
    return this
  }

  addLinks(): this {
    return this
  }

  end(endTime?: TimeInput): void {
    const span: OtlpSpan = {
      traceId: this.#context.traceID,
      spanId: this.#context.spanID,
      name: this.#name,
      kind: 2,
      startTimeUnixNano: String(this.#startTimeUnixNano),
      endTimeUnixNano: String(unixNanoFromTimeInput(endTime)),
      attributes: otlpAttributes({
        ...this.#attributes,
        request_id: this.#requestID,
      }),
      status: this.#status,
    }
    if (this.#context.parentSpanID !== undefined) {
      span.parentSpanId = this.#context.parentSpanID
    }

    this.#exportPromise = exportSpan(
      this.#fetchApi,
      this.#endpoint,
      this.#serviceName,
      this.#deploymentEnvironment,
      span,
    ).catch(error => console.warn(error))
  }

  exported(): Promise<void> {
    return this.#exportPromise ?? Promise.resolve()
  }

  isRecording(): boolean {
    return true
  }

  recordException(exception: Error | string): void {
    this.#attributes["error.type"] =
      typeof exception === "string" ? exception : exception.name
    this.#status = {
      code: 2,
      message: typeof exception === "string" ? exception : exception.message,
    }
  }

  setAttribute(key: string, value: SpanAttributeValue): this {
    this.#attributes[key] = value
    return this
  }

  setAttributes(attributes: SpanAttributes): this {
    this.#attributes = { ...this.#attributes, ...attributes }
    return this
  }

  setStatus(status: SpanStatus): this {
    this.#status =
      status.code === 2 &&
      status.message === undefined &&
      this.#status.message !== undefined
        ? { ...status, message: this.#status.message }
        : status
    return this
  }

  spanContext(): SpanContext {
    return {
      traceId: this.#context.traceID,
      spanId: this.#context.spanID,
      traceFlags: this.#context.sampled ? 1 : 0,
    }
  }

  updateName(name: string): this {
    this.#name = name
    return this
  }
}

class ExportingTracer implements Tracer {
  #context: TraceContext
  #deploymentEnvironment: string | undefined
  #endpoint: string
  #fetchApi: typeof fetch
  #requestID: string
  #serviceName: string

  constructor(
    context: TraceContext,
    requestID: string,
    endpoint: string,
    serviceName: string,
    deploymentEnvironment: string | undefined,
    fetchApi: typeof fetch,
  ) {
    this.#context = context
    this.#deploymentEnvironment = deploymentEnvironment
    this.#endpoint = endpoint
    this.#fetchApi = fetchApi
    this.#requestID = requestID
    this.#serviceName = serviceName
  }

  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    context: unknown,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    optionsOrFn: SpanOptions | F,
    contextOrFn?: unknown,
    maybeFn?: F,
  ): ReturnType<F> {
    const options = typeof optionsOrFn === "function" ? undefined : optionsOrFn
    const fn =
      typeof optionsOrFn === "function"
        ? optionsOrFn
        : typeof contextOrFn === "function"
          ? contextOrFn
          : maybeFn
    if (fn === undefined) {
      throw new Error("startActiveSpan requires a callback")
    }

    const span = new ExportedSpan(
      name,
      this.#context,
      this.#requestID,
      this.#endpoint,
      this.#serviceName,
      this.#deploymentEnvironment,
      this.#fetchApi,
      options,
    )
    const result = fn(span)
    if (
      result !== null &&
      typeof result === "object" &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      return (async () => {
        try {
          return await result
        } finally {
          await span.exported()
        }
      })() as ReturnType<F>
    }

    return result as ReturnType<F>
  }

  startSpan(name: string, options?: SpanOptions): Span {
    return new ExportedSpan(
      name,
      this.#context,
      this.#requestID,
      this.#endpoint,
      this.#serviceName,
      this.#deploymentEnvironment,
      this.#fetchApi,
      options,
    )
  }
}

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
    const context = requestTraceContext(c.req.raw)
    const requestID = generatedRequestID(c.req.raw)
    const traceparent = traceparentValue(context)
    const request = requestWithTraceHeaders(c.req.raw, traceparent, requestID)

    c.set("recurringTracingRequest", request)
    c.header(headerTraceID, context.traceID)
    c.header(headerSpanID, context.spanID)
    c.header(headerRequestID, requestID)

    const endpoint = optionValue(c, config.traceEndpoint)
    if (endpoint === undefined) {
      await httpInstrumentationMiddleware({
        disableTracing: true,
        serviceName: config.serviceName,
        spanNameFactory: c => `${c.req.method} ${routePath(c)}`,
      })(c, next)
      c.header(headerTraceID, context.traceID)
      c.header(headerSpanID, context.spanID)
      c.header(headerRequestID, requestID)
      return
    }

    const deploymentEnvironment = optionValue(c, config.deploymentEnvironment)
    await httpInstrumentationMiddleware({
      serviceName: config.serviceName,
      spanNameFactory: c => `${c.req.method} ${routePath(c)}`,
      tracer: new ExportingTracer(
        context,
        requestID,
        endpoint,
        config.serviceName,
        deploymentEnvironment,
        config.fetch ?? fetch,
      ),
    })(c, next)

    c.header(headerTraceID, context.traceID)
    c.header(headerSpanID, context.spanID)
    c.header(headerRequestID, requestID)
  }

  return tracingMiddleware
}
