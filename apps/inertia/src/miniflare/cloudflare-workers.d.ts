declare module "cloudflare:workers" {
  import type { EnvVars } from "../config/env.schema.ts"

  export const env: EnvVars

  export const exports: {
    default: {
      fetch: (request: Request) => Promise<Response> | Response
    }
  }
}
