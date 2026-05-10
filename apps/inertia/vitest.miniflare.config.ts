import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => {
  const recurringAPIOrigin = process.env["RECURRING_API_ORIGIN"]
  if (recurringAPIOrigin === undefined) {
    throw new Error("RECURRING_API_ORIGIN is required")
  }

  const plugin = cloudflareTest({
    main: "./src/worker.ts",
    wrangler: {
      configPath: "./wrangler.toml",
      environment: "test",
    },
    miniflare: {
      bindings: {
        RECURRING_API_ORIGIN: recurringAPIOrigin,
      },
    },
  })

  return {
    plugins: [plugin],
    test: {
      coverage: {
        provider: "istanbul" as const,
      },
      disableConsoleIntercept: true,
      globalSetup: ["./src/miniflare/oauth2-mock-server.ts"],
      include: ["src/miniflare/**/*.test.ts"],
    },
  }
})
