import { isRecord } from "@recurring/shared-ts"
import { describe, expect, test } from "vitest"

import { Paths, type WebPathLiteral } from "../paths.ts"
import { waitForJaegerTrace } from "./jaeger.ts"

type InertiaPage = {
  component: string
  props: {
    expenses?: unknown[]
    health?: {
      status: string
    }
    projects?: unknown[]
  }
  url: string
  version: string
}

const sessionIDPattern = /^sess_/
const projectID = "prj_1"
const traceIDPattern = /^[0-9a-f]{32}$/
const spanIDPattern = /^[0-9a-f]{16}$/
const inertiaVersion = INERTIA_VERSION
const recurringAPIOrigin = requireEnv("RECURRING_API_ORIGIN")
const recurringWebOrigin = requireEnv("RECURRING_WEB_ORIGIN")

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }

  return value
}

const route = (x: WebPathLiteral): URL =>
  new URL(x, recurringWebOrigin)

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
  const res = await fetch(new URL("/v1/signup", recurringAPIOrigin), {
    body: JSON.stringify({
      google_sub: `google-${unique}`,
      email: `e2e-${unique}@example.com`,
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

async function createSessionProject(
  workerFetch: typeof fetch,
): Promise<{ projectID: string; sessionID: string }> {
  const sessionID = await createSessionID()
  const res = await workerFetch(
    new Request(route(Paths.home), {
      headers: { Cookie: `sessionID=${sessionID}` },
      redirect: "manual",
    }),
  )
  if (res.status !== 302) {
    throw new Error(`home redirect failed with status ${res.status}`)
  }

  const location = new URL(requireHeader(res, "location"))
  const redirectedProjectID = location.pathname.replace("/projects/", "")
  if (!redirectedProjectID.startsWith("prj_")) {
    throw new Error(`home redirect returned invalid project id ${redirectedProjectID}`)
  }

  return { projectID: redirectedProjectID, sessionID }
}

async function createProject(sessionID: string, name: string): Promise<string> {
  const res = await fetch(
    new URL("/v1/session/projects", recurringAPIOrigin),
    {
      body: JSON.stringify({ name }),
      headers: {
        Authorization: `Bearer ${sessionID}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  )
  if (res.status !== 201) {
    throw new Error(`project creation failed with status ${res.status}`)
  }

  const payload = await res.json()
  if (!isRecord(payload) || typeof payload["id"] !== "string") {
    throw new Error("project creation response is missing id")
  }
  if (!payload["id"].startsWith("prj_")) {
    throw new Error(`project creation returned invalid project id ${payload["id"]}`)
  }

  return payload["id"]
}

describe("inertia worker", () => {
  const workerFetch = fetch

  test("reads the wrapped worker test origins", () => {
    expect(recurringAPIOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(new URL(recurringWebOrigin).origin).toMatch(
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
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
    expect(location.pathname).toMatch(/^\/projects\/prj_/)
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
    const canonical = await createSessionProject(workerFetch)
    const res = await workerFetch(
      new Request(route(Paths.project(canonical.projectID)), {
        headers: { Cookie: `sessionID=${canonical.sessionID}` },
      }),
    )

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    expect(cookieValue(requireHeader(res, "set-cookie"), "lastProjectID")).toEqual(
      canonical.projectID,
    )
  })

  test("serves requested project route instead of redirecting to first project", async () => {
    const canonical = await createSessionProject(workerFetch)
    const secondProjectID = await createProject(canonical.sessionID, "Work")
    const res = await workerFetch(
      new Request(route(Paths.project(secondProjectID)), {
        headers: { Cookie: `sessionID=${canonical.sessionID}` },
      }),
    )

    expect(res.status).toEqual(200)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    expect(cookieValue(requireHeader(res, "set-cookie"), "lastProjectID")).toEqual(
      secondProjectID,
    )
  })

  test("serves invalid project id as 404 HTML with 404 page payload", async () => {
    const sessionID = await createSessionID()
    const res = await workerFetch(
      new Request(route(Paths.project("invalid")), {
        headers: { Cookie: `sessionID=${sessionID}` },
      }),
    )

    expect(res.status).toEqual(404)
    expect(requireHeader(res, "content-type")).toContain("text/html")
    const html = await res.text()
    expect(html).toContain('"component":"404"')
  })

  test("serves Inertia navigation as page JSON", async () => {
    const canonical = await createSessionProject(workerFetch)
    const res = await workerFetch(
      new Request(route(Paths.project(canonical.projectID)), {
        headers: {
          Accept: "text/html, application/xhtml+xml",
          Cookie: `sessionID=${canonical.sessionID}`,
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
      component: "Project",
      props: {
        expenses: [],
        projects: [
          {
            id: canonical.projectID,
            name: "Home",
          },
        ],
      },
      url: Paths.project(canonical.projectID),
      version: inertiaVersion,
    })
  })

  test("serves invalid project id Inertia navigation as 404 page JSON", async () => {
    const sessionID = await createSessionID()
    const res = await workerFetch(
      new Request(route(Paths.project("invalid")), {
        headers: {
          Cookie: `sessionID=${sessionID}`,
          "X-Inertia": "true",
          "X-Inertia-Version": inertiaVersion,
        },
      }),
    )
    const page = await parseInertiaPage(res)

    expect(res.status).toEqual(404)
    expect(requireHeader(res, "x-inertia")).toEqual("true")
    expect(page).toEqual<InertiaPage>({
      component: "404",
      props: {},
      url: Paths.project("invalid"),
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
    expect(authorizationURL.searchParams.get("client_id")).not.toEqual(null)
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
