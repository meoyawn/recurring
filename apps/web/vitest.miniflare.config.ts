import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { createBuilder } from "vite"
import { defineConfig } from "vitest/config"

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
      include: ["src/miniflare/**/*.test.ts"],
    },
  }
})
