import { env } from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "../lib/api.ts"

describe("apiOrigin", () => {
  test("reads the Wrangler API origin binding from Miniflare", () => {
    expect(apiOrigin(env)).toEqual("http://localhost:8080")
  })
})
