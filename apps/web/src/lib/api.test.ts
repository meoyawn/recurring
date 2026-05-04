import { env } from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "./api.ts"

describe("apiOrigin", () => {
  test("reads the Miniflare API origin binding", () => {
    expect(apiOrigin(env)).toEqual("https://api.example.test")
  })
})
