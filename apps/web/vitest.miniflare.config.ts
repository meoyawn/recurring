import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

/** Slow tests */
export default defineConfig(async () => {
  return {
    plugins: [
      cloudflareTest({
        main: "./.output/server/index.mjs",
        wrangler: {
          configPath: "./wrangler.toml",
          environment: "test",
        },
      }),
    ],
    test: {
      disableConsoleIntercept: true,
      globalSetup: ["./src/miniflare/oauth-test-servers.ts"],
      include: ["src/miniflare/**/*.test.ts"],
    },
  }
})
