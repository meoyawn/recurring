import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => {
  const recurringAPIOrigin = process.env["RECURRING_API_ORIGIN"]
  const workerOptions = {
    main: "./src/worker.ts",
    wrangler: {
      configPath: "./wrangler.toml",
      environment: "test",
    },
  }
  const plugin =
    recurringAPIOrigin === undefined
      ? cloudflareTest(workerOptions)
      : cloudflareTest({
          ...workerOptions,
          miniflare: {
            bindings: {
              RECURRING_API_ORIGIN: recurringAPIOrigin,
            },
          },
        })

  return {
    plugins: [plugin],
    test: {
      disableConsoleIntercept: true,
      globalSetup: ["./src/miniflare/oauth-server.ts"],
      include: ["src/miniflare/**/*.test.ts"],
    },
  }
})
