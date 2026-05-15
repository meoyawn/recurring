import { cloudflare } from "@cloudflare/vite-plugin"
import { inertiaPages } from "@hono/inertia/vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import ssrPlugin from "vite-ssr-components/plugin"

import { inertiaVersion } from "./inertia-version.ts"
import { wranglerVars } from "./src/config/wrangler.toml.ts"

type WorkerTestEnvName =
  | "RECURRING_API_ORIGIN"
  | "RECURRING_WEB_ORIGIN"
  | "GOOGLE_AUTHORIZATION_ENDPOINT"
  | "GOOGLE_TOKEN_ENDPOINT"
  | "GOOGLE_USERINFO_ENDPOINT"

function requireWorkerTestEnv(name: WorkerTestEnvName): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }

  return value
}

function workerTestVars(): Record<WorkerTestEnvName, string> | undefined {
  if (process.env["RECURRING_CF_WORKER_TEST"] !== "1") {
    return undefined
  }

  return {
    RECURRING_API_ORIGIN: requireWorkerTestEnv("RECURRING_API_ORIGIN"),
    RECURRING_WEB_ORIGIN: requireWorkerTestEnv("RECURRING_WEB_ORIGIN"),
    GOOGLE_AUTHORIZATION_ENDPOINT: requireWorkerTestEnv(
      "GOOGLE_AUTHORIZATION_ENDPOINT",
    ),
    GOOGLE_TOKEN_ENDPOINT: requireWorkerTestEnv("GOOGLE_TOKEN_ENDPOINT"),
    GOOGLE_USERINFO_ENDPOINT: requireWorkerTestEnv("GOOGLE_USERINFO_ENDPOINT"),
  }
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
