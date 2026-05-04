import { env } from "cloudflare:workers"
import { describe, expect, test } from "vitest"

import { apiOrigin } from "./api.ts"

describe("apiOrigin", () => {
  test("reads the Miniflare API origin binding", () => {
    expect(apiOrigin(env)).toEqual("https://api.example.test")
  })

  test("rejects missing API origin binding", () => {
    expect(() => apiOrigin({})).toThrow("RECURRING_API_ORIGIN is required")
  })

  test("rejects empty API origin binding", () => {
    expect(() =>
      apiOrigin({
        RECURRING_API_ORIGIN: "",
      }),
    ).toThrow("RECURRING_API_ORIGIN is required")
  })
})
