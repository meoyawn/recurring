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
        },
      }),
    ],
    test: {
      disableConsoleIntercept: true,
      include: ["src/miniflare/**/*.test.ts"],
    },
  }
})
