import { solidStart } from "@solidjs/start/config"
import { nitroV2Plugin } from "@solidjs/vite-plugin-nitro-2"
import { defineConfig } from "vite"

export default defineConfig(() => ({
  plugins: [
    solidStart({
      /** SSR serializes initial props; `clientOnly` keeps route body CSR. */
      ssr: true,
    }),
    /**
     * SolidStart v2 runs via Vite; this emits Nitro server output for SSR and
     * API routes.
     */
    nitroV2Plugin(),
  ],
}))
