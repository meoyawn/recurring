import { defineConfig, loadEnv } from "vite";
import { nitroV2Plugin as nitro } from "@solidjs/vite-plugin-nitro-2";
import { solidStart } from "@solidjs/start/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiOrigin = env.RECURRING_API_ORIGIN ?? "http://127.0.0.1:8080";

  return {
    server: {
      proxy: {
        "/api/backend": {
          target: apiOrigin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/backend/, "") || "/",
        },
      },
    },
    plugins: [
      solidStart(),
      nitro({
        routeRules: {
          "/api/backend/**": {
            proxy: { to: `${apiOrigin.replace(/\/$/, "")}/**` },
          },
        },
      }),
    ],
  };
});
