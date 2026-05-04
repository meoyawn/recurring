import { exports as workerExports } from "cloudflare:workers"
import { describe, expect, test } from "vitest"

describe("web worker", () => {
  test("serves the SolidStart health check", async () => {
    /**
     * Mirrors the SELF proxy from cloudflare:test. Miniflare resolves the
     * default worker export lazily, so reading workerExports.default once can
     * see undefined before the loopback binding is ready.
     */
    const worker = new Proxy(
      {},
      {
        get(_, key) {
          const target = (
            workerExports as { default: Record<PropertyKey, unknown> }
          ).default
          const value = target[key]

          return typeof value === "function" ? value.bind(target) : value
        },
      },
    ) as { fetch: (request: Request) => Promise<Response> | Response }

    const response = await worker.fetch(
      new Request("http://example.test/healthz"),
    )

    expect(response.status).toEqual(200)
  })
})
