import { defineConfig } from "@playwright/test"

const playwrightWSEndpoint =
  process.env["PW_TEST_CONNECT_WS_ENDPOINT"] ?? "ws://127.0.0.1:3000/"

export default defineConfig({
  testDir: "src/e2e/browser",
  workers: 1,
  use: {
    browserName: "chromium",
    connectOptions: {
      wsEndpoint: playwrightWSEndpoint,
    },
  },
})
