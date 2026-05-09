import { cloudflare } from "@cloudflare/vite-plugin"
import { inertiaPages } from "@hono/inertia/vite"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import ssrPlugin from "vite-ssr-components/plugin"

export default defineConfig({
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
