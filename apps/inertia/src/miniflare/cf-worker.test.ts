import * as cfWorkers from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "../app/api.ts"

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

function getFetch(exports: WorkerExports): Worker["fetch"] {
  const worker = exports.default
  return worker.fetch.bind(worker)
}

const route = (x: `/${string}`): URL => new URL(x, "http://expample.test")

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isInertiaPage = (value: unknown): value is InertiaPage =>
  isRecord(value) &&
  typeof value["component"] === "string" &&
  isRecord(value["props"]) &&
  typeof value["url"] === "string" &&
  typeof value["version"] === "string"

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

  test("serves the Hono health check", async () => {
    const res = await workerFetch(new Request(route("/healthz")))
    expect(res.status).toEqual(200)
  })

  test("serves first Inertia visit as HTML with initial page props", async () => {
    const res = await workerFetch(new Request(route("/")))

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain('<script data-page="app" type="application/json">')
    expect(html).toContain('"component":"Home"')
    expect(html).toContain('"health":{"status":"ok"}')
  })

  test("serves Inertia navigation as page JSON", async () => {
    const res = await workerFetch(
      new Request(route("/status"), {
        headers: {
          Accept: "text/html, application/xhtml+xml",
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
      component: "Status",
      props: { health: { status: "ok" } },
      url: "/status",
      version: "recurring-inertia-1",
    })
  })

  test("returns Inertia asset mismatch reload response", async () => {
    const res = await workerFetch(
      new Request(route("/"), {
        headers: {
          "X-Inertia": "true",
          "X-Inertia-Version": "stale",
        },
      }),
    )

    expect(res.status).toEqual(409)
    expect(requireHeader(res, "x-inertia-location")).toEqual(route("/").toString())
  })

  test("finishes Google OAuth against the mock OAuth server", async () => {
    const startRes = await workerFetch(
      new Request(route("/auth/google/start"), { redirect: "manual" }),
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
      route("/auth/google/callback").toString(),
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
    expect(callbackURL.origin).toEqual(route("/").origin)
    expect(callbackURL.pathname).toEqual("/auth/google/callback")
    expect(callbackURL.searchParams.get("state")).toEqual(state)

    const finishRes = await workerFetch(
      new Request(callbackURL, {
        headers: { Cookie: `googleOAuthState=${encodeURIComponent(state)}` },
        redirect: "manual",
      }),
    )
    expect(finishRes.status).toEqual(303)
    expect(requireHeader(finishRes, "location")).toEqual(route("/").toString())
    expect(
      sessionIDPattern.test(
        cookieValue(requireHeader(finishRes, "set-cookie"), "sessionID"),
      ),
    ).toEqual(true)
  })
})
