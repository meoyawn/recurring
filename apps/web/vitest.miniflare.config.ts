import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

/** Slow tests */
export default defineConfig(async () => {
  const recurringAPIOrigin = process.env["RECURRING_API_ORIGIN"]

  return {
    plugins: [
      cloudflareTest({
        main: "./.output/server/index.mjs",
        miniflare: recurringAPIOrigin
          ? {
              bindings: {
                RECURRING_API_ORIGIN: recurringAPIOrigin,
              },
            }
          : undefined,
        wrangler: {
          configPath: "./wrangler.toml",
          environment: "test",
        },
      }),
    ],
    test: {
      disableConsoleIntercept: true,
      globalSetup: ["./src/miniflare/oauth-server.ts"],
      include: ["src/miniflare/**/*.test.ts"],
    },
  }
})
