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

export type ServiceClientAttemptEvent = {
  attempt: number
  maxAttempts: number
  method: string
  url: string
}

export type ServiceClientResponseEvent = ServiceClientAttemptEvent & {
  durationMs: number
  status: number
}

export type ServiceClientErrorEvent = ServiceClientAttemptEvent & {
  durationMs: number
  error: unknown
}

type PreparedRequest = {
  bodyReplayable: boolean
  headers: Headers
  init: RequestInit
  input: RequestInfo | URL
  method: string
  retryable: boolean
  url: string
}

type AttemptSignal = {
  cleanup: () => void
  signal?: AbortSignal
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])
const retryableStatuses = new Set([502, 503, 504])

const normalizedAttempts = (value: number | undefined): number =>
  Math.max(1, Math.trunc(value ?? 3))

const normalizedBackoffMs = (value: number | undefined): number =>
  Math.max(0, value ?? 100)

const requestURL = (input: RequestInfo | URL): string => {
  if (input instanceof Request) {
    return input.url
  }

  return input.toString()
}

const requestMethod = (input: RequestInfo | URL, init: RequestInit): string => {
  if (init.method !== undefined) {
    return init.method.toUpperCase()
  }
  if (input instanceof Request) {
    return input.method.toUpperCase()
  }

  return "GET"
}

const mergeHeaders = (
  input: RequestInfo | URL,
  init: RequestInit,
  options: ServiceClientOptions,
): Headers => {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  )
  for (const [name, value] of new Headers(options.headers)) {
    headers.set(name, value)
  }
  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value)
  }

  const context = options.context
  if (context?.traceparent !== undefined) {
    headers.set("traceparent", context.traceparent)
  }
  if (context?.tracestate !== undefined) {
    headers.set("tracestate", context.tracestate)
  }
  if (context?.requestID !== undefined) {
    headers.set("x-request-id", context.requestID)
  }
  if (context?.idempotencyKey !== undefined) {
    headers.set("idempotency-key", context.idempotencyKey)
  }

  return headers
}

const initBodyReplayable = (body: BodyInit | null | undefined): boolean =>
  !(body instanceof ReadableStream)

const requestBodyReplayable = (
  input: RequestInfo | URL,
  init: RequestInit,
): boolean => {
  if (init.body !== undefined) {
    return initBodyReplayable(init.body)
  }
  if (input instanceof Request && input.body !== null) {
    return false
  }

  return true
}

const isRetryable = (
  method: string,
  context: ServiceClientContext | undefined,
): boolean =>
  safeMethods.has(method) ||
  (context?.retryable === true && context.idempotencyKey !== undefined)

const prepareRequest = (
  input: RequestInfo | URL,
  init: RequestInit,
  options: ServiceClientOptions,
): PreparedRequest => {
  const method = requestMethod(input, init)

  return {
    bodyReplayable: requestBodyReplayable(input, init),
    headers: mergeHeaders(input, init, options),
    init,
    input,
    method,
    retryable: isRetryable(method, options.context),
    url: requestURL(input),
  }
}

const attemptSignal = (
  signal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): AttemptSignal => {
  if (timeoutMs === undefined) {
    return { cleanup: () => {}, signal: signal ?? undefined }
  }

  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    timeoutMs,
  )

  function abort() {
    controller.abort()
  }

  if (signal !== null && signal !== undefined) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener("abort", abort, { once: true })
    }
  }

  return {
    cleanup: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
        timeout = undefined
      }
      signal?.removeEventListener("abort", abort)
    },
    signal: controller.signal,
  }
}

const delay = async (ms: number): Promise<void> => {
  if (ms === 0) {
    return
  }

  await new Promise(resolve => setTimeout(resolve, ms))
}

const shouldRetryResponse = (response: Response): boolean =>
  retryableStatuses.has(response.status)

const attemptEvent = (
  request: PreparedRequest,
  attempt: number,
  maxAttempts: number,
): ServiceClientAttemptEvent => ({
  attempt,
  maxAttempts,
  method: request.method,
  url: request.url,
})

const requestForAttempt = (
  request: PreparedRequest,
  signal: AbortSignal | undefined,
): Request =>
  new Request(request.input, {
    ...request.init,
    headers: request.headers,
    method: request.method,
    signal,
  })

export const serviceFetch = (
  options: ServiceClientOptions = {},
): typeof fetch => {
  const fetchApi = options.fetch ?? fetch

  async function serviceClientFetch(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const request = prepareRequest(input, init, options)
    const maxAttempts =
      request.retryable && request.bodyReplayable
        ? normalizedAttempts(options.maxAttempts)
        : 1
    const retryBackoffMs = normalizedBackoffMs(options.retryBackoffMs)

    if (request.retryable && !request.bodyReplayable) {
      throw new TypeError("retryable requests require a replayable body")
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const event = attemptEvent(request, attempt, maxAttempts)
      const startedAtMs = Date.now()
      const signal = attemptSignal(init.signal, options.timeoutMs)
      options.onAttempt?.(event)

      try {
        const response = await fetchApi(
          requestForAttempt(request, signal.signal),
        )
        options.onResponse?.({
          ...event,
          durationMs: Date.now() - startedAtMs,
          status: response.status,
        })

        if (
          attempt < maxAttempts &&
          request.retryable &&
          shouldRetryResponse(response)
        ) {
          signal.cleanup()
          await delay(retryBackoffMs)
          continue
        }

        signal.cleanup()
        return response
      } catch (error) {
        signal.cleanup()
        options.onError?.({
          ...event,
          durationMs: Date.now() - startedAtMs,
          error,
        })

        if (
          attempt < maxAttempts &&
          request.retryable &&
          !init.signal?.aborted
        ) {
          await delay(retryBackoffMs)
          continue
        }

        throw error
      }
    }

    throw new Error("serviceFetch exhausted attempts without a response")
  }

  serviceClientFetch.preconnect = fetchApi.preconnect
  return serviceClientFetch
}
