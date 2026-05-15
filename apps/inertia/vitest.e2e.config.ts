import { defineConfig } from "vitest/config"

import { inertiaVersion } from "./inertia-version.ts"

export default defineConfig({
  define: {
    INERTIA_VERSION: JSON.stringify(inertiaVersion()),
  },
  test: {
    coverage: {
      provider: "istanbul" as const,
    },
    disableConsoleIntercept: true,
    include: ["src/e2e/**/*.test.ts"],
  },
})
