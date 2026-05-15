import { afterAll, beforeAll, describe, test } from "bun:test"
import { chromium, expect, type Browser } from "@playwright/test"
import { Paths } from "../paths.ts"

describe("login page", () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser.close()
  })

  test("renders a Google sign-in button", async () => {
    const recurringWebOrigin = process.env["RECURRING_WEB_ORIGIN"]
    if (recurringWebOrigin === undefined) {
      throw new Error("RECURRING_WEB_ORIGIN is required")
    }

    if (browser === undefined) {
      throw new Error("browser is required")
    }

    const page = await browser.newPage()
    await page.goto(new URL(Paths.login, recurringWebOrigin).toString())
    await expect(page.getByRole("button", { name: /google/i })).toBeVisible()
  })
})
