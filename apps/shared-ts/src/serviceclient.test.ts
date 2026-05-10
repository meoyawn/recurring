import { describe, expect, test } from "bun:test"
import {
  serviceFetch,
  type ServiceClientErrorEvent,
  type ServiceClientResponseEvent,
} from "./serviceclient.ts"

type FetchCapture = {
  fetch: typeof fetch
  requests: Request[]
}

const captureFetch = (
  handler: (request: Request, attempt: number) => Promise<Response> | Response,
): FetchCapture => {
  const requests: Request[] = []

  async function fetchMock(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init)
    requests.push(request.clone())
    return handler(request, requests.length)
  }

  fetchMock.preconnect = fetch.preconnect
  return { fetch: fetchMock, requests }
}

describe("serviceFetch", () => {
  test("preserves caller headers", async () => {
    const capture = captureFetch(() => new Response(null, { status: 204 }))
    const fetchApi = serviceFetch({ fetch: capture.fetch })

    await fetchApi("https://internal.test/healthz", {
      headers: { Authorization: "Bearer token" },
    })

    expect(capture.requests[0]?.headers.get("authorization")).toEqual(
      "Bearer token",
    )
  })

  test("forwards trace and request headers from context", async () => {
    const capture = captureFetch(() => new Response(null, { status: 204 }))
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      context: {
        requestID: "req-1",
        traceparent: "00-00000000000000000000000000000001-0000000000000002-01",
        tracestate: "vendor=value",
      },
    })

    await fetchApi("https://internal.test/healthz")

    expect({
      requestID: capture.requests[0]?.headers.get("x-request-id"),
      traceparent: capture.requests[0]?.headers.get("traceparent"),
      tracestate: capture.requests[0]?.headers.get("tracestate"),
    }).toEqual({
      requestID: "req-1",
      traceparent: "00-00000000000000000000000000000001-0000000000000002-01",
      tracestate: "vendor=value",
    })
  })

  test("retries GET network errors", async () => {
    const capture = captureFetch((_, attempt) => {
      if (attempt === 1) {
        throw new TypeError("network failed")
      }

      return new Response(null, { status: 204 })
    })
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      retryBackoffMs: 0,
    })

    const response = await fetchApi("https://internal.test/healthz")

    expect(response.status).toEqual(204)
    expect(capture.requests.length).toEqual(2)
  })

  test("does not retry POST by default", async () => {
    const capture = captureFetch(() => new Response(null, { status: 503 }))
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      retryBackoffMs: 0,
    })

    const response = await fetchApi("https://internal.test/signups", {
      body: "{}",
      method: "POST",
    })

    expect(response.status).toEqual(503)
    expect(capture.requests.length).toEqual(1)
  })

  test("retries retryable POST with an idempotency key and replayable body", async () => {
    const capture = captureFetch((_, attempt) =>
      new Response(null, { status: attempt === 1 ? 503 : 201 }),
    )
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      retryBackoffMs: 0,
      context: {
        idempotencyKey: "signup-1",
        retryable: true,
      },
    })

    const response = await fetchApi("https://internal.test/signups", {
      body: "{}",
      method: "POST",
    })

    expect(response.status).toEqual(201)
    expect(capture.requests.length).toEqual(2)
    expect(capture.requests[0]?.headers.get("idempotency-key")).toEqual(
      "signup-1",
    )
  })

  test("does not retry retryable POST without an idempotency key", async () => {
    const capture = captureFetch(() => new Response(null, { status: 503 }))
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      retryBackoffMs: 0,
      context: {
        retryable: true,
      },
    })

    const response = await fetchApi("https://internal.test/signups", {
      body: "{}",
      method: "POST",
    })

    expect(response.status).toEqual(503)
    expect(capture.requests.length).toEqual(1)
  })

  test("rejects retryable POST with a streamed body", async () => {
    const fetchApi = serviceFetch({
      fetch: captureFetch(() => new Response()).fetch,
      context: {
        idempotencyKey: "signup-1",
        retryable: true,
      },
    })
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"))
        controller.close()
      },
    })

    await expect(
      fetchApi("https://internal.test/signups", {
        body,
        method: "POST",
      }),
    ).rejects.toThrow("retryable requests require a replayable body")
  })

  test("retries 502 503 and 504 responses", async () => {
    const capture = captureFetch((_, attempt) =>
      new Response(null, {
        status: [502, 503, 504, 204][attempt - 1],
      }),
    )
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      maxAttempts: 4,
      retryBackoffMs: 0,
    })

    const response = await fetchApi("https://internal.test/healthz")

    expect(response.status).toEqual(204)
    expect(capture.requests.length).toEqual(4)
  })

  test("emits attempt response and error events", async () => {
    const responses: ServiceClientResponseEvent[] = []
    const errors: ServiceClientErrorEvent[] = []
    const capture = captureFetch((_, attempt) => {
      if (attempt === 1) {
        throw new TypeError("network failed")
      }

      return new Response(null, { status: 204 })
    })
    const fetchApi = serviceFetch({
      fetch: capture.fetch,
      onError: event => errors.push(event),
      onResponse: event => responses.push(event),
      retryBackoffMs: 0,
    })

    await fetchApi("https://internal.test/healthz")

    expect(errors.length).toEqual(1)
    expect(responses.length).toEqual(1)
    expect(errors[0]?.attempt).toEqual(1)
    expect(errors[0]?.error).toBeInstanceOf(TypeError)
    expect(typeof errors[0]?.durationMs).toEqual("number")
    expect(responses[0]?.attempt).toEqual(2)
    expect(responses[0]?.status).toEqual(204)
    expect(typeof responses[0]?.durationMs).toEqual("number")
  })
})
