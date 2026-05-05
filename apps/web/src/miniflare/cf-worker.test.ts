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

function getFetch(exports: WorkerExports): Worker["fetch"] {
  const worker = exports.default
  return worker.fetch.bind(worker)
}

const route = (x: `/${string}`): URL => new URL(x, "http://expample.test")

describe("web worker", () => {
  const workerFetch = getFetch(cfWorkers.exports as WorkerExports)

  test("reads the Wrangler API origin binding from Miniflare", () => {
    expect(apiOrigin(cfWorkers.env)).toEqual("http://localhost:8080")
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
})
