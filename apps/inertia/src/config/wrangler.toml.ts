import { parse } from "valibot"
import { unstable_readConfig } from "wrangler"

import { envVarsSchema, type EnvVars } from "./env.schema.ts"

type WranglerEnvironment = "development" | "production" | "test"

export const wranglerVars = (env: WranglerEnvironment): EnvVars => {
  const config = unstable_readConfig({
    config: "wrangler.toml",
    env,
  })
  return parse(envVarsSchema, config.vars)
}

export const mockAuthServerURL = (): URL => {
  const vars = wranglerVars("test")
  const authorizationEndpoint = new URL(vars.GOOGLE_AUTHORIZATION_ENDPOINT)
  const tokenEndpoint = new URL(vars.GOOGLE_TOKEN_ENDPOINT)
  const userinfoEndpoint = new URL(vars.GOOGLE_USERINFO_ENDPOINT)

  if (
    authorizationEndpoint.origin !== tokenEndpoint.origin ||
    authorizationEndpoint.origin !== userinfoEndpoint.origin
  ) {
    throw new Error("Google OAuth mock endpoints must share one origin")
  }

  if (authorizationEndpoint.port === "") {
    throw new Error("Google OAuth mock endpoint must include a port")
  }

  return authorizationEndpoint
}
