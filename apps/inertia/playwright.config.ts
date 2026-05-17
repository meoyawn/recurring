import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "src/e2e/browser/",
  use: {
    browserName: "chromium",
  },
})
