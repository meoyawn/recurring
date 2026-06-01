import { cloudflare } from "@cloudflare/vite-plugin"
import { inertiaPages } from "@hono/inertia/vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import ssrPlugin from "vite-ssr-components/plugin"

import { inertiaVersion } from "./inertia-version.ts"
import type { EnvVars } from "./src/config/env.schema.ts"
import { wranglerVars } from "./src/config/wrangler.toml.ts"

type WorkerTestEnvName = keyof EnvVars

function workerTestVars(): Record<WorkerTestEnvName, string> | undefined {
  if (process.env["RECURRING_CF_WORKER_TEST"] !== "1") {
    return undefined
  }

  return process.env as unknown as Record<WorkerTestEnvName, string>
}

const recurringWebOrigin = new URL(
  process.env["RECURRING_WEB_ORIGIN"] ??
    wranglerVars("development").RECURRING_WEB_ORIGIN,
)

const recurringWorkerTestVars = workerTestVars()

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
    cloudflare({
      config(config) {
        if (recurringWorkerTestVars === undefined) {
          return {}
        }

        return {
          vars: {
            ...config.vars,
            ...recurringWorkerTestVars,
          },
        }
      },
    }),
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
