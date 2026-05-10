import { describe, expect, test } from "vitest"
import { parseInitialPage } from "./initial-page.ts"
import { WebPath } from "./paths.ts"

describe("parseInitialPage", () => {
  test("reads Hono script payload", () => {
    const page = {
      component: "Home",
      props: { health: { ok: true } },
      url: WebPath.home,
      version: "recurring-inertia-1",
    }

    expect(parseInitialPage(JSON.stringify(page), "app")).toEqual(page)
  })

  test("rejects missing payload", () => {
    expect(() => parseInitialPage(null, "app")).toThrow(
      "Inertia page payload for app is missing",
    )
  })
})
