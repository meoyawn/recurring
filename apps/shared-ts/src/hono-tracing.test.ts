import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import {
  honoTracing,
  otlpTraceEndpointFromEnv,
  tracedRequest,
} from "./hono-tracing.ts"

type FetchCapture = {
  fetch: typeof fetch
  requests: Request[]
}

type OtlpPayload = {
  resourceSpans: {
    resource: {
      attributes: {
        key: string
        value: Record<string, unknown>
      }[]
    }
    scopeSpans: {
      spans: {
        attributes: {
          key: string
          value: Record<string, unknown>
        }[]
        name: string
        parentSpanId?: string
        spanId: string
        traceId: string
      }[]
    }[]
  }[]
}

const captureFetch = (): FetchCapture => {
  const requests: Request[] = []

  async function fetchMock(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init)
    requests.push(request.clone())
    return new Response(null, { status: 204 })
  }

  fetchMock.preconnect = fetch.preconnect
  return { fetch: fetchMock, requests }
}

const attributeValues = (
  attributes: {
    key: string
    value: Record<string, unknown>
  }[],
): Record<string, Record<string, unknown>> =>
  Object.fromEntries(attributes.map(attribute => [attribute.key, attribute.value]))

const parseOtlpPayload = async (request: Request): Promise<OtlpPayload> =>
  (await request.json()) as OtlpPayload

const requireHeader = (response: Response, name: string): string => {
  const value = response.headers.get(name)
  if (value === null) {
    throw new Error(`${name} response header is missing`)
  }

  return value
}

const requireRequest = (request: Request | undefined): Request => {
  if (request === undefined) {
    throw new Error("request is missing")
  }

  return request
}

describe("honoTracing", () => {
  test("adds trace headers and exports a Hono OTEL server span", async () => {
    const capture = captureFetch()
    const app = new Hono()
    app.use(
      honoTracing({
        deploymentEnvironment: "test",
        fetch: capture.fetch,
        serviceName: "recurring-test",
        traceEndpoint: "https://collector.test/v1/traces",
      }),
    )
    app.get("/healthz", c =>
      c.json({
        requestID: tracedRequest(c).headers.get("x-request-id"),
        traceparent: tracedRequest(c).headers.get("traceparent"),
        tracestate: tracedRequest(c).headers.get("tracestate"),
      }),
    )

    const response = await app.request("/healthz", {
      headers: {
        traceparent:
          "00-00000000000000000000000000000001-0000000000000002-01",
        tracestate: "vendor=value",
        "x-request-id": "req-1",
      },
    })
    const responseSpanID = requireHeader(response, "x-span-id")
    const body = await response.json()
    const payload = await parseOtlpPayload(requireRequest(capture.requests[0]))
    const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0]
    const attributes = attributeValues(span?.attributes ?? [])
    const resourceAttributes = attributeValues(
      payload.resourceSpans[0]?.resource.attributes ?? [],
    )

    expect(response.headers.get("x-request-id")).toEqual("req-1")
    expect(response.headers.get("x-trace-id")).toEqual(
      "00000000000000000000000000000001",
    )
    expect(body).toEqual({
      requestID: "req-1",
      traceparent: `00-00000000000000000000000000000001-${responseSpanID}-01`,
      tracestate: "vendor=value",
    })
    expect(capture.requests[0]?.url).toEqual("https://collector.test/v1/traces")
    expect({
      name: span?.name,
      parentSpanId: span?.parentSpanId,
      spanId: span?.spanId,
      traceId: span?.traceId,
    }).toEqual({
      name: "GET /healthz",
      parentSpanId: "0000000000000002",
      spanId: responseSpanID,
      traceId: "00000000000000000000000000000001",
    })
    expect(attributes["request_id"]).toEqual({ stringValue: "req-1" })
    expect(attributes["http.request.method"]).toEqual({ stringValue: "GET" })
    expect(attributes["http.route"]).toEqual({ stringValue: "/healthz" })
    expect(attributes["http.response.status_code"]).toEqual({ intValue: "200" })
    expect(attributes["deployment.environment"]).toEqual({
      stringValue: "test",
    })
    expect(resourceAttributes["service.name"]).toEqual({
      stringValue: "recurring-test",
    })
  })
})

describe("otlpTraceEndpointFromEnv", () => {
  test("prefers the traces endpoint", () => {
    expect(
      otlpTraceEndpointFromEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          "https://collector.test/custom/traces",
      }),
    ).toEqual("https://collector.test/custom/traces")
  })

  test("derives the traces endpoint from the base endpoint", () => {
    expect(
      otlpTraceEndpointFromEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test/",
      }),
    ).toEqual("https://collector.test/v1/traces")
  })
})
