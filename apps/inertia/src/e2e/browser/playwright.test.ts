import { expect, test } from "@playwright/test"

import type { EnvVars } from "../../config/env.schema.ts"
import { sessionCookieName } from "../../app/cookie/session-cookie.ts"
import { Paths } from "../../paths.ts"
import { createSessionID } from "../api.ts"

function requireEnv(name: keyof EnvVars): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }

  return value
}

test.describe("browser e2e", () => {
  test("login page renders a Google sign-in button", async ({ page }) => {
    await page.goto(
      new URL(Paths.login, requireEnv("RECURRING_WEB_ORIGIN")).toString(),
    )
    await expect(page.getByRole("button", { name: /google/i })).toBeVisible()
  })

  test("serves invalid project id as 404 HTML with 404 page payload", async ({
    context,
    page,
  }) => {
    const webOrigin = requireEnv("RECURRING_WEB_ORIGIN")
    await context.addCookies([
      {
        name: sessionCookieName,
        url: webOrigin,
        value: await createSessionID(),
      },
    ])

    const res = await page.goto(
      new URL(Paths.project("invalid"), webOrigin).toString(),
    )

    expect(res?.status()).toEqual(404)
    const pagePayload = await page
      .locator('script[data-page="app"][type="application/json"]')
      .evaluate(element => element.textContent)

    expect(pagePayload).toContain('"component":"404"')
  })
})
