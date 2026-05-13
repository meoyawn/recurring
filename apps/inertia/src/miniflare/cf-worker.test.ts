import { isRecord } from "@recurring/shared-ts"
import * as cfWorkers from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { Paths, type WebPathLiteral } from "../paths.ts"
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

const sessionIDPattern = /^sess_[0-9a-f]{32}$/
const projectID = "prj_00000000000000000000000000000001"
const traceIDPattern = /^[0-9a-f]{32}$/
const spanIDPattern = /^[0-9a-f]{16}$/
const inertiaVersion = INERTIA_VERSION

function getFetch(exports: WorkerExports): Worker["fetch"] {
  const worker = exports.default
  return worker.fetch.bind(worker)
}

const route = (x: WebPathLiteral): URL =>
  new URL(x, cfWorkers.env.RECURRING_WEB_ORIGIN)

const requireHeader = (response: Response, name: string): string => {
  const value = response.headers.get(name)
  if (value === null) {
    throw new Error(`${name} response header is missing`)
  }

  return value
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

async function createSessionID(): Promise<string> {
  const unique = crypto.randomUUID()
  const res = await fetch(new URL("/v1/signup", cfWorkers.env.RECURRING_API_ORIGIN), {
    body: JSON.stringify({
      google_sub: `google-${unique}`,
      email: `miniflare-${unique}@example.com`,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  if (!res.ok) {
    throw new Error(`signup failed with status ${res.status}`)
  }

  const payload = await res.json()
  if (!isRecord(payload) || typeof payload["session_id"] !== "string") {
    throw new Error("signup response is missing session_id")
  }

  return payload["session_id"]
}

describe("inertia worker", () => {
  const workerFetch = getFetch(cfWorkers.exports as WorkerExports)

  test("reads the Wrangler API origin binding from Miniflare", () => {
    expect(cfWorkers.env.RECURRING_API_ORIGIN).toMatch(
      /^http:\/\/(recurring\.localhost:8082|127\.0\.0\.1:\d+)$/,
    )
  })

  test("serves the Hono health check with a Jaeger lookup trace ID", async () => {
    const res = await workerFetch(new Request(route(Paths.healthz)))

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "x-trace-id")).toMatch(traceIDPattern)
    expect(requireHeader(res, "x-span-id")).toMatch(spanIDPattern)
    await waitForJaegerTrace(requireHeader(res, "x-trace-id"))
  })

  test("redirects first visit without a session cookie to login", async () => {
    const res = await workerFetch(
      new Request(route(Paths.home), { redirect: "manual" }),
    )

    expect(res.status).toEqual(302)
    expect(requireHeader(res, "location")).toEqual(
      route(Paths.login).toString(),
    )
  })

  test("serves login as HTML with Login page payload", async () => {
    const res = await workerFetch(new Request(route(Paths.login)))

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain('<script data-page="app" type="application/json">')
    expect(html).toContain('"component":"Login"')
  })

  test("redirects first signed-in visit to first project", async () => {
    const sessionID = await createSessionID()
    const res = await workerFetch(
      new Request(route(Paths.home), {
        headers: { Cookie: `sessionID=${sessionID}` },
        redirect: "manual",
      }),
    )

    expect(res.status).toEqual(302)
    const location = new URL(requireHeader(res, "location"))
    expect(location.origin).toEqual(route(Paths.home).origin)
    expect(location.pathname).toMatch(/^\/projects\/prj_[0-9a-f]{32}$/)
    expect(cookieValue(requireHeader(res, "set-cookie"), "lastProjectID")).toEqual(
      location.pathname.replace("/projects/", ""),
    )
  })

  test("redirects home to last project from cookie", async () => {
    const res = await workerFetch(
      new Request(route(Paths.home), {
        headers: {
          Cookie: `sessionID=sess_test; lastProjectID=${projectID}`,
        },
        redirect: "manual",
      }),
    )

    expect(res.status).toEqual(302)
    expect(requireHeader(res, "location")).toEqual(
      route(Paths.project(projectID)).toString(),
    )
  })

  test("serves project route and stores last project cookie", async () => {
    const res = await workerFetch(
      new Request(route(Paths.project(projectID)), {
        headers: { Cookie: "sessionID=sess_test" },
      }),
    )

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    expect(cookieValue(requireHeader(res, "set-cookie"), "lastProjectID")).toEqual(
      projectID,
    )
  })

  test("serves Inertia navigation as page JSON", async () => {
    const res = await workerFetch(
      new Request(route(Paths.project(projectID)), {
        headers: {
          Accept: "text/html, application/xhtml+xml",
          Cookie: "sessionID=sess_test",
          "X-Inertia": "true",
          "X-Inertia-Version": inertiaVersion,
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
      url: Paths.project(projectID),
      version: inertiaVersion,
    })
  })

  test("returns Inertia asset mismatch reload response", async () => {
    const res = await workerFetch(
      new Request(route(Paths.home), {
        headers: {
          "X-Inertia": "true",
          "X-Inertia-Version": "stale",
        },
      }),
    )

    expect(res.status).toEqual(409)
    expect(requireHeader(res, "x-inertia-location")).toEqual(
      route(Paths.home).toString(),
    )
  })

  test("finishes Google OAuth against the mock OAuth server", async () => {
    const startRes = await workerFetch(
      new Request(route(Paths.googleAuthStart), { redirect: "manual" }),
    )
    expect(startRes.status).toEqual(302)

    const stateCookie = requireHeader(startRes, "set-cookie")
    const state = cookieValue(stateCookie, "googleOAuthState")
    const authorizationURL = new URL(requireHeader(startRes, "location"))
    expect(authorizationURL.pathname).toEqual("/authorize")
    expect(authorizationURL.searchParams.get("client_id")).toEqual(
      "test-google-client",
    )
    expect(authorizationURL.searchParams.get("redirect_uri")).toEqual(
      route(Paths.googleAuthCallback).toString(),
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
    expect(callbackURL.origin).toEqual(route(Paths.home).origin)
    expect(callbackURL.pathname).toEqual(Paths.googleAuthCallback)
    expect(callbackURL.searchParams.get("state")).toEqual(state)

    const finishRes = await workerFetch(
      new Request(callbackURL, {
        headers: { Cookie: `googleOAuthState=${encodeURIComponent(state)}` },
        redirect: "manual",
      }),
    )
    expect(finishRes.status).toEqual(302)
    expect(requireHeader(finishRes, "location")).toEqual(
      route(Paths.home).toString(),
    )
    const setCookie = requireHeader(finishRes, "set-cookie")
    const sessionCookie = setCookie
      .split(", ")
      .find(value => value.startsWith("sessionID="))
    if (sessionCookie === undefined) {
      throw new Error("sessionID Set-Cookie header is missing")
    }
    expect(
      sessionIDPattern.test(cookieValue(sessionCookie, "sessionID")),
    ).toEqual(true)
    expect(sessionCookie).not.toContain("Path=")
  })
})
