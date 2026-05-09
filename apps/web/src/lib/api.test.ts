import { describe, expect, test } from "vitest"

import { apiOrigin } from "./api.ts"

describe("apiOrigin", () => {
  test("reads the Wrangler API origin binding", () => {
    expect(
      apiOrigin({
        RECURRING_API_ORIGIN: "http://localhost:8080",
        GOOGLE_AUTHORIZATION_ENDPOINT: "http://localhost:8081/authorize",
        GOOGLE_TOKEN_ENDPOINT: "http://localhost:8081/token",
        GOOGLE_USERINFO_ENDPOINT: "http://localhost:8081/userinfo",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GOOGLE_REDIRECT_URI: "",
      }),
    ).toEqual("http://localhost:8080")
  })
})
