import { expect, test } from "@playwright/test"

import { Paths } from "../../paths.ts"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }

  return value
}

test("login page renders a Google sign-in button", async ({ page }) => {
  await page.goto(new URL(Paths.login, requireEnv("RECURRING_WEB_ORIGIN")).toString())
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible()
})
