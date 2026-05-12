declare module "cloudflare:workers" {
  import type { EnvVars } from "../env.schema.ts"

  export const env: EnvVars
  export const exports: {
    default: {
      fetch: (request: Request) => Promise<Response> | Response
    }
  }
}
