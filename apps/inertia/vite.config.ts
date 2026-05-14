import { cloudflare } from "@cloudflare/vite-plugin"
import { inertiaPages } from "@hono/inertia/vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import ssrPlugin from "vite-ssr-components/plugin"

import { inertiaVersion } from "./inertia-version.ts"
import { wranglerVars } from "./src/config/wrangler.toml.ts"

const recurringWebOrigin = new URL(
  wranglerVars("development").RECURRING_WEB_ORIGIN,
)

export default defineConfig({
  define: {
    /**
     * Inertia reloads stale clients on version mismatch; this can discard
     * in-progress form input.
     */
    INERTIA_VERSION: JSON.stringify(inertiaVersion()),
  },
  server: {
    host: recurringWebOrigin.hostname,
    port: Number.parseInt(recurringWebOrigin.port, 10),
  },
  plugins: [
    inertiaPages({
      pagesDir: "src/pages",
      outFile: "src/pages.gen.ts",
      serverModule: "./worker.ts",
    }),
    solid(),
    cloudflare(),
    ssrPlugin({
      entry: {
        target: ["src/client-entry.tsx"],
      },
      hotReload: {
        target: ["src/**/*.ts", "src/**/*.tsx"],
      },
    }),
  ],
})
