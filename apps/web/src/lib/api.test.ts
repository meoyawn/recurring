import { describe, expect, test } from "vitest"

import { apiOrigin } from "./api.ts"

describe("apiOrigin", () => {
  test("reads the Wrangler API origin binding", () => {
    expect(
      apiOrigin({
        RECURRING_API_ORIGIN: "http://localhost:8080",
      }),
    ).toEqual("http://localhost:8080")
  })
})
