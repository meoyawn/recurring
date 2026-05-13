import { isHttpURL, type HttpURL } from "@recurring/shared-ts"
import { Hono } from "hono"
import { describe, expect, test } from "vitest"
import type { EnvVars } from "../config/env.schema.ts"
import { apiContextMiddleware, healthCheck } from "./api.ts"

type CapturedRequest = {
  authorization: string | null
  idempotencyKey: string | null
  traceparent: string | null
  tracestate: string | null
  url: string
  requestID: string | null
}

const envVars = (recurringApiOrigin: HttpURL): EnvVars => ({
  GOOGLE_AUTHORIZATION_ENDPOINT: "https://accounts.google.test/authorize",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_TOKEN_ENDPOINT: "https://accounts.google.test/token",
  GOOGLE_USERINFO_ENDPOINT: "https://accounts.google.test/userinfo",
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.test",
  RECURRING_API_ORIGIN: recurringApiOrigin,
  RECURRING_WEB_ORIGIN: "https://web.test",
})

describe("healthCheck", () => {
  test("shares cached API origin while keeping request context per Hono ctx", async () => {
    const captured: CapturedRequest[] = []
    const apiServer = new Hono()
    apiServer.get("/healthz", c => {
      captured.push({
        authorization: c.req.header("authorization") ?? null,
        idempotencyKey: c.req.header("idempotency-key") ?? null,
        requestID: c.req.header("x-request-id") ?? null,
        traceparent: c.req.header("traceparent") ?? null,
        tracestate: c.req.header("tracestate") ?? null,
        url: c.req.url,
      })

      return c.body(null, 204)
    })
    const server = Bun.serve({
      fetch: apiServer.fetch,
      port: 0,
    })

    try {
      const web = new Hono<{ Bindings: EnvVars }>()
      web.use(apiContextMiddleware)
      web.get("/", async c => {
        await healthCheck()
        return c.body(null, 204)
      })
      if (!isHttpURL(server.url.origin)) {
        throw new Error("server origin is not an HTTP URL")
      }
      const env = envVars(server.url.origin)

      const first = await web.request(
        "https://web.test/",
        {
          headers: {
            Cookie: "sessionID=sess_first",
            "idempotency-key": "idem-1",
            traceparent:
              "00-00000000000000000000000000000001-0000000000000002-01",
            tracestate: "vendor=one",
            "x-request-id": "req-1",
          },
        },
        env,
      )
      const second = await web.request(
        "https://web.test/",
        {
          headers: {
            Cookie: "sessionID=sess_second",
            "idempotency-key": "idem-2",
            traceparent:
              "00-00000000000000000000000000000003-0000000000000004-01",
            tracestate: "vendor=two",
            "x-request-id": "req-2",
          },
        },
        env,
      )

      expect(first.status).toEqual(204)
      expect(second.status).toEqual(204)
      expect(captured).toEqual<CapturedRequest[]>([
        {
          authorization: "Bearer sess_first",
          idempotencyKey: "idem-1",
          requestID: "req-1",
          traceparent:
            "00-00000000000000000000000000000001-0000000000000002-01",
          tracestate: "vendor=one",
          url: `${server.url.origin}/healthz`,
        },
        {
          authorization: "Bearer sess_second",
          idempotencyKey: "idem-2",
          requestID: "req-2",
          traceparent:
            "00-00000000000000000000000000000003-0000000000000004-01",
          tracestate: "vendor=two",
          url: `${server.url.origin}/healthz`,
        },
      ])
    } finally {
      await server.stop(true)
    }
  })
})
