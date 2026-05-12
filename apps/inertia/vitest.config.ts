import { ViteToml } from "vite-plugin-toml"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [ViteToml()],
  test: {
    exclude: [...configDefaults.exclude, "src/miniflare/**/*.test.ts"],
  },
})
