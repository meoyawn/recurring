import { configDefaults, defineConfig } from "vitest/config"

/** Fast tests */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "src/miniflare/**/*.test.ts"],
  },
})
