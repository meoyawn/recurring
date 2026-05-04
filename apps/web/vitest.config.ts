import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          RECURRING_API_ORIGIN: "https://api.example.test/",
        },
        compatibilityDate: "2026-05-04",
      },
    }),
  ],
})
