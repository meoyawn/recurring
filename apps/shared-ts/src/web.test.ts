import { describe, expect, test } from "bun:test"
import { isHttpURL, type HttpURL } from "./web.ts"

describe("isHttpURL", () => {
  test("accepts http and https URLs", () => {
    expect(isHttpURL("http://example.test")).toEqual(true)
    expect(isHttpURL("https://example.test")).toEqual(true)
  })

  test("rejects non-HTTP URLs and malformed URLs", () => {
    expect(isHttpURL("ftp://example.test")).toEqual(false)
    expect(isHttpURL("mailto:test@example.test")).toEqual(false)
    expect(isHttpURL("not a url")).toEqual(false)
  })

  test("narrows strings to HttpURL", () => {
    const value = "https://example.test"
    if (!isHttpURL(value)) {
      throw new Error("valid HTTP URL rejected")
    }

    const url: HttpURL = value
    expect(url).toEqual("https://example.test")
  })
})
