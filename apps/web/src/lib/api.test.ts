import { env } from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "./api.ts"

describe("apiOrigin", () => {
  test("reads the Wrangler API origin binding", () => {
    expect(apiOrigin(env)).toEqual("http://localhost:8080")
  })
})
