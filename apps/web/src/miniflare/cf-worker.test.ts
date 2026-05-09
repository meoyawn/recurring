import * as cfWorkers from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "../lib/api.ts"
import { googleAuthEndpoints } from "../lib/googleAuth.ts"

interface Worker {
  fetch: (request: Request) => Promise<Response> | Response
}

interface WorkerExports {
  default: Worker
}

type CapturedRequests = {
  signupRequests: unknown[]
  tokenRequests: unknown[]
}

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
  if (match === null) {
    throw new Error(`${name} cookie is missing`)
  }

  return decodeURIComponent(match[1])
}

const resetCapturedRequests = async () => {
  await fetch("http://localhost:8082/__reset", { method: "POST" })
}

const capturedRequests = async (): Promise<CapturedRequests> => {
  const response = await fetch("http://localhost:8082/__requests")
  return response.json()
}

describe("web worker", () => {
  const workerFetch = getFetch(cfWorkers.exports as WorkerExports)

  test("reads the Wrangler API origin binding from Miniflare", () => {
    expect(apiOrigin(cfWorkers.env)).toEqual("http://localhost:8082")
  })

  test("reads the Wrangler Google OAuth endpoint bindings from Miniflare", () => {
    expect(googleAuthEndpoints(cfWorkers.env)).toEqual({
      authorizationEndpoint: "http://localhost:8081/authorize",
      tokenEndpoint: "http://localhost:8081/token",
      userinfoEndpoint: "http://localhost:8081/userinfo",
    })
  })

  test("serves the SolidStart health check", async () => {
    const res = await workerFetch(new Request(route("/healthz")))
    expect(res.status).toEqual(200)
  })

  test("finishes Google OAuth against the mock OAuth server", async () => {
    await resetCapturedRequests()

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
    expect(requireHeader(finishRes, "set-cookie")).toContain(
      "sessionID=sess_test",
    )

    expect(await capturedRequests()).toEqual({
      tokenRequests: [
        {
          client_id: "test-google-client",
          client_secret: "test-google-secret",
          code: callbackURL.searchParams.get("code"),
          grant_type: "authorization_code",
          redirect_uri: route("/auth/google/callback").toString(),
        },
      ],
      signupRequests: [
        {
          body: {
            google_sub: "google-sub-123",
            email: "person@example.test",
            name: "Person Example",
            picture_url: "https://example.test/avatar.png",
          },
        },
      ],
    })
  })
})
