declare module "cloudflare:workers" {
  export const env: Env
  export const exports: {
    default: {
      fetch: (request: Request) => Promise<Response> | Response
    }
  }
}
