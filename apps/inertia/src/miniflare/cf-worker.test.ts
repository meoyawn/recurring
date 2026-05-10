import { isRecord } from "@recurring/shared-ts"
import * as cfWorkers from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "../app/api.ts"
import { WebPath, type WebPathLiteral } from "../paths.ts"
import { waitForJaegerTrace } from "./jaeger.ts"

interface Worker {
  fetch: (request: Request) => Promise<Response> | Response
}

interface WorkerExports {
  default: Worker
}

type InertiaPage = {
  component: string
  props: {
    health?: {
      status: string
    }
  }
  url: string
  version: string
}

type CapturedAPIRequest = {
  headers: Record<string, string>
  method: string
  url: string
}

type ParsedTraceparent = {
  flags: string
  spanID: string
  traceID: string
}

const sessionIDPattern = /^sess_[0-9a-f]{32}$/
const traceIDPattern = /^[0-9a-f]{32}$/
const spanIDPattern = /^[0-9a-f]{16}$/
const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const apiCaptureOrigin = "http://localhost:8083"

function getFetch(exports: WorkerExports): Worker["fetch"] {
  const worker = exports.default
  return worker.fetch.bind(worker)
}

const route = (x: WebPathLiteral): URL => new URL(x, "http://expample.test")

const requireHeader = (response: Response, name: string): string => {
  const value = response.headers.get(name)
  if (value === null) {
    throw new Error(`${name} response header is missing`)
  }

  return value
}

const parseTraceparent = (value: string | undefined): ParsedTraceparent => {
  const match = value?.match(traceparentPattern)
  if (match === null || match === undefined) {
    throw new Error("traceparent is invalid")
  }
  const traceID = match[1]
  const spanID = match[2]
  const flags = match[3]
  if (traceID === undefined || spanID === undefined || flags === undefined) {
    throw new Error("traceparent match is invalid")
  }

  return { flags, spanID, traceID }
}

const cookieValue = (setCookie: string, name: string): string => {
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`))
  const value = match?.[1]
  if (value === undefined) {
    throw new Error(`${name} cookie is missing`)
  }

  return decodeURIComponent(value)
}

const parseInertiaPage = async (response: Response): Promise<InertiaPage> => {
  const page = await response.json()
  if (!isInertiaPage(page)) {
    throw new Error("response is not an Inertia page")
  }

  return page
}

const isInertiaPage = (value: unknown): value is InertiaPage =>
  isRecord(value) &&
  typeof value["component"] === "string" &&
  isRecord(value["props"]) &&
  typeof value["url"] === "string" &&
  typeof value["version"] === "string"

const isCapturedAPIRequest = (value: unknown): value is CapturedAPIRequest =>
  isRecord(value) &&
  isRecord(value["headers"]) &&
  typeof value["method"] === "string" &&
  typeof value["url"] === "string"

const capturedAPIRequests = async (): Promise<CapturedAPIRequest[]> => {
  const response = await fetch(`${apiCaptureOrigin}/__requests`)
  const requests = await response.json()
  if (!Array.isArray(requests) || !requests.every(isCapturedAPIRequest)) {
    throw new Error("captured API requests response is invalid")
  }

  return requests
}

describe("inertia worker", () => {
  const workerFetch = getFetch(cfWorkers.exports as WorkerExports)

  test("reads the Wrangler API origin binding from Miniflare", () => {
    expect(apiOrigin(cfWorkers.env)).toMatch(
      /^http:\/\/(localhost:8082|127\.0\.0\.1:\d+)$/,
    )
  })

  test("reads the Wrangler Google OAuth endpoint bindings from Miniflare", () => {
    expect({
      authorizationEndpoint: cfWorkers.env.GOOGLE_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: cfWorkers.env.GOOGLE_TOKEN_ENDPOINT,
      userinfoEndpoint: cfWorkers.env.GOOGLE_USERINFO_ENDPOINT,
    }).toEqual({
      authorizationEndpoint: "http://localhost:8081/authorize",
      tokenEndpoint: "http://localhost:8081/token",
      userinfoEndpoint: "http://localhost:8081/userinfo",
    })
  })

  test("serves the Hono health check with a Jaeger lookup trace ID", async () => {
    const res = await workerFetch(new Request(route(WebPath.healthz)))

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "x-trace-id")).toMatch(traceIDPattern)
    expect(requireHeader(res, "x-span-id")).toMatch(spanIDPattern)
    await waitForJaegerTrace(requireHeader(res, "x-trace-id"))
  })

  test("redirects first visit without a session cookie to login", async () => {
    const res = await workerFetch(
      new Request(route(WebPath.home), { redirect: "manual" }),
    )

    expect(res.status).toEqual(302)
    expect(requireHeader(res, "location")).toEqual(
      route(WebPath.login).toString(),
    )
  })

  test("serves login as HTML with Login page payload", async () => {
    const res = await workerFetch(new Request(route(WebPath.login)))

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain('<script data-page="app" type="application/json">')
    expect(html).toContain('"component":"Login"')
  })

  test("serves first Inertia visit as HTML with initial page props", async () => {
    const res = await workerFetch(
      new Request(route(WebPath.home), {
        headers: { Cookie: "sessionID=sess_test" },
      }),
    )

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain('<script data-page="app" type="application/json">')
    expect(html).toContain('"component":"Home"')
    expect(html).toContain('"health":{"status":"ok"}')
  })

  test("serves Inertia navigation as page JSON", async () => {
    const res = await workerFetch(
      new Request(route(WebPath.home), {
        headers: {
          Accept: "text/html, application/xhtml+xml",
          Cookie: "sessionID=sess_test",
          "X-Inertia": "true",
          "X-Inertia-Version": "recurring-inertia-1",
        },
      }),
    )
    const page = await parseInertiaPage(res)

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "x-inertia")).toEqual("true")
    expect(requireHeader(res, "vary")).toContain("X-Inertia")
    expect(page).toEqual<InertiaPage>({
      component: "Home",
      props: { health: { status: "ok" } },
      url: WebPath.home,
      version: "recurring-inertia-1",
    })
  })

  test("forwards trace headers to the Recurring API call", async () => {
    const originalAPIOrigin = cfWorkers.env.RECURRING_API_ORIGIN
    await fetch(`${apiCaptureOrigin}/__reset`, { method: "POST" })
    Object.defineProperty(cfWorkers.env, "RECURRING_API_ORIGIN", {
      configurable: true,
      value: apiCaptureOrigin,
    })

    try {
      const res = await workerFetch(
        new Request(route(WebPath.home), {
          headers: {
            Cookie: "sessionID=sess_test",
            traceparent:
              "00-00000000000000000000000000000001-0000000000000002-01",
            tracestate: "vendor=value",
          },
        }),
      )

      expect(res.status).toEqual(200)
      const responseTraceID = requireHeader(res, "x-trace-id")
      const responseSpanID = requireHeader(res, "x-span-id")
      const requests = await capturedAPIRequests()
      const apiTraceparent = parseTraceparent(requests[0]?.headers["traceparent"])
      expect(requests.length).toEqual(1)
      expect({
        requestID: requests[0]?.headers["x-request-id"],
        tracestate: requests[0]?.headers["tracestate"],
        traceFlags: apiTraceparent.flags,
        traceID: apiTraceparent.traceID,
        traceSpanID: apiTraceparent.spanID,
      }).toEqual({
        requestID: requireHeader(res, "x-request-id"),
        tracestate: "vendor=value",
        traceFlags: "01",
        traceID: responseTraceID,
        traceSpanID: responseSpanID,
      })
    } finally {
      Object.defineProperty(cfWorkers.env, "RECURRING_API_ORIGIN", {
        configurable: true,
        value: originalAPIOrigin,
      })
    }
  })

  test("creates trace headers for Recurring API calls without inbound trace context", async () => {
    const originalAPIOrigin = cfWorkers.env.RECURRING_API_ORIGIN
    await fetch(`${apiCaptureOrigin}/__reset`, { method: "POST" })
    Object.defineProperty(cfWorkers.env, "RECURRING_API_ORIGIN", {
      configurable: true,
      value: apiCaptureOrigin,
    })

    try {
      const res = await workerFetch(
        new Request(route(WebPath.home), {
          headers: { Cookie: "sessionID=sess_test" },
        }),
      )

      expect(res.status).toEqual(200)
      const requests = await capturedAPIRequests()
      const apiTraceparent = parseTraceparent(requests[0]?.headers["traceparent"])
      expect(requests.length).toEqual(1)
      expect({
        requestID: requests[0]?.headers["x-request-id"],
        traceFlags: apiTraceparent.flags,
        traceID: apiTraceparent.traceID,
        traceSpanID: apiTraceparent.spanID,
      }).toEqual({
        requestID: requireHeader(res, "x-request-id"),
        traceFlags: "01",
        traceID: requireHeader(res, "x-trace-id"),
        traceSpanID: requireHeader(res, "x-span-id"),
      })
    } finally {
      Object.defineProperty(cfWorkers.env, "RECURRING_API_ORIGIN", {
        configurable: true,
        value: originalAPIOrigin,
      })
    }
  })

  test("returns Inertia asset mismatch reload response", async () => {
    const res = await workerFetch(
      new Request(route(WebPath.home), {
        headers: {
          "X-Inertia": "true",
          "X-Inertia-Version": "stale",
        },
      }),
    )

    expect(res.status).toEqual(409)
    expect(requireHeader(res, "x-inertia-location")).toEqual(
      route(WebPath.home).toString(),
    )
  })

  test("finishes Google OAuth against the mock OAuth server", async () => {
    const startRes = await workerFetch(
      new Request(route(WebPath.googleAuthStart), { redirect: "manual" }),
    )
    expect(startRes.status).toEqual(302)

    const stateCookie = requireHeader(startRes, "set-cookie")
    const state = cookieValue(stateCookie, "googleOAuthState")
    const authorizationURL = new URL(requireHeader(startRes, "location"))
    expect(authorizationURL.origin).toEqual("http://localhost:8081")
    expect(authorizationURL.pathname).toEqual("/authorize")
    expect(authorizationURL.searchParams.get("client_id")).toEqual(
      "test-google-client",
    )
    expect(authorizationURL.searchParams.get("redirect_uri")).toEqual(
      route(WebPath.googleAuthCallback).toString(),
    )
    expect(authorizationURL.searchParams.get("response_type")).toEqual("code")
    expect(authorizationURL.searchParams.get("scope")).toEqual(
      "openid profile email",
    )
    expect(authorizationURL.searchParams.get("state")).toEqual(state)

    const authorizationRes = await fetch(authorizationURL, {
      redirect: "manual",
    })
    expect(authorizationRes.status).toEqual(302)

    const callbackURL = new URL(requireHeader(authorizationRes, "location"))
    expect(callbackURL.origin).toEqual(route(WebPath.home).origin)
    expect(callbackURL.pathname).toEqual(WebPath.googleAuthCallback)
    expect(callbackURL.searchParams.get("state")).toEqual(state)

    const finishRes = await workerFetch(
      new Request(callbackURL, {
        headers: { Cookie: `googleOAuthState=${encodeURIComponent(state)}` },
        redirect: "manual",
      }),
    )
    expect(finishRes.status).toEqual(302)
    expect(requireHeader(finishRes, "location")).toEqual(
      route(WebPath.home).toString(),
    )
    expect(
      sessionIDPattern.test(
        cookieValue(requireHeader(finishRes, "set-cookie"), "sessionID"),
      ),
    ).toEqual(true)
  })
})
