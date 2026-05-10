import { OAuth2Client } from "@badgateway/oauth2-client"
import type { EmailAddrStr } from "@recurring/shared-ts"
import { upsertSignup } from "./api.ts"
import { requiredRuntimeEnv, runtimeEnv } from "./runtime-env.ts"

const googleStateCookieName = "googleOAuthState"
const sessionCookieName = "sessionID"

type GoogleAuthConfig = {
  authorizationEndpoint: string
  clientId: string
  clientSecret: string
  redirectURI: string
  tokenEndpoint: string
  userinfoEndpoint: string
}

type CookieOptions = {
  path: string
  maxAge: number
  secure: boolean
}

type GoogleProfile = {
  sub: string
  email: EmailAddrStr
  name?: string
  picture?: string
}

type GoogleAuthEndpoints = {
  authorizationEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isEmailAddress = (value: string): value is EmailAddrStr =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const publicOrigin = (request: Request): string => {
  const forwardedProto = request.headers.get("x-forwarded-proto")
  const forwardedHost = request.headers.get("x-forwarded-host")
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return new URL(request.url).origin
}

const isSecureRequest = (request: Request): boolean =>
  new URL(request.url).protocol === "https:"

const cookie = (name: string, value: string, opts: CookieOptions): string => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ]
  if (opts.secure) {
    parts.push("Secure")
  }
  return parts.join("; ")
}

const clearCookie = (name: string, path: string, secure: boolean): string =>
  cookie(name, "", { path, maxAge: 0, secure })

const readCookie = (request: Request, name: string): string | undefined => {
  const header = request.headers.get("cookie")
  if (!header) {
    return undefined
  }

  for (const pair of header.split(";")) {
    const trimmed = pair.trim()
    const separator = trimmed.indexOf("=")
    if (separator === -1) {
      continue
    }
    if (trimmed.slice(0, separator) === name) {
      return decodeURIComponent(trimmed.slice(separator + 1))
    }
  }

  return undefined
}

const redirect = (
  location: string,
  status: 302 | 303,
  cookies: string[] = [],
): Response => {
  const headers = new Headers({ Location: location })
  for (const value of cookies) {
    headers.append("Set-Cookie", value)
  }
  return new Response(null, { status, headers })
}

const errorRedirect = (
  request: Request,
  code: string,
  cookies: string[] = [],
): Response => {
  const url = new URL("/", publicOrigin(request))
  url.searchParams.set("auth", code)
  return redirect(url.toString(), 303, cookies)
}

export const googleAuthEndpoints = (bindings: Env): GoogleAuthEndpoints => ({
  authorizationEndpoint: requiredRuntimeEnv(
    "GOOGLE_AUTHORIZATION_ENDPOINT",
    bindings,
  ),
  tokenEndpoint: requiredRuntimeEnv("GOOGLE_TOKEN_ENDPOINT", bindings),
  userinfoEndpoint: requiredRuntimeEnv("GOOGLE_USERINFO_ENDPOINT", bindings),
})

const authConfig = (
  request: Request,
  bindings: Env,
  callbackPath: string,
): GoogleAuthConfig => {
  const endpoints = googleAuthEndpoints(bindings)

  return {
    authorizationEndpoint: endpoints.authorizationEndpoint,
    tokenEndpoint: endpoints.tokenEndpoint,
    userinfoEndpoint: endpoints.userinfoEndpoint,
    clientId: requiredRuntimeEnv("GOOGLE_CLIENT_ID", bindings),
    clientSecret: requiredRuntimeEnv("GOOGLE_CLIENT_SECRET", bindings),
    redirectURI:
      runtimeEnv("GOOGLE_REDIRECT_URI", bindings) ??
      new URL(callbackPath, publicOrigin(request)).toString(),
  }
}

const oauthClient = (config: GoogleAuthConfig): OAuth2Client =>
  new OAuth2Client({
    authorizationEndpoint: config.authorizationEndpoint,
    authenticationMethod: "client_secret_post",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenEndpoint: config.tokenEndpoint,
  })

const randomState = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

const parseGoogleProfile = (value: unknown): GoogleProfile => {
  if (
    !isRecord(value) ||
    typeof value["sub"] !== "string" ||
    typeof value["email"] !== "string" ||
    !isEmailAddress(value["email"])
  ) {
    throw new Error("Google profile response is invalid")
  }

  const profile: GoogleProfile = {
    sub: value["sub"],
    email: value["email"],
  }
  if (typeof value["name"] === "string") {
    profile.name = value["name"]
  }
  if (typeof value["picture"] === "string") {
    profile.picture = value["picture"]
  }
  return profile
}

const fetchGoogleProfile = async (
  accessToken: string,
  config: GoogleAuthConfig,
): Promise<GoogleProfile> => {
  const res = await fetch(config.userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`)
  }

  return parseGoogleProfile(await res.json())
}

export const startGoogleAuth = async (
  request: Request,
  bindings: Env,
  callbackPath: string,
): Promise<Response> => {
  try {
    const config = authConfig(request, bindings, callbackPath)
    const state = randomState()
    const authorizationURL = await oauthClient(
      config,
    ).authorizationCode.getAuthorizeUri({
      extraParams: { prompt: "select_account" },
      redirectUri: config.redirectURI,
      scope: ["openid", "profile", "email"],
      state,
    })

    return redirect(authorizationURL, 302, [
      cookie(googleStateCookieName, state, {
        path: callbackPath,
        maxAge: 600,
        secure: isSecureRequest(request),
      }),
    ])
  } catch {
    return errorRedirect(request, "configuration_error")
  }
}

export const finishGoogleAuth = async (
  request: Request,
  bindings: Env,
  callbackPath: string,
): Promise<Response> => {
  const secure = isSecureRequest(request)
  const clearState = clearCookie(googleStateCookieName, callbackPath, secure)

  try {
    const url = new URL(request.url)
    const error = url.searchParams.get("error")
    if (error) {
      return errorRedirect(request, error, [clearState])
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    if (!code || !state) {
      return errorRedirect(request, "invalid_callback", [clearState])
    }

    if (state !== readCookie(request, googleStateCookieName)) {
      return errorRedirect(request, "invalid_state", [clearState])
    }

    const config = authConfig(request, bindings, callbackPath)
    const token = await oauthClient(config).authorizationCode.getToken({
      code,
      redirectUri: config.redirectURI,
    })
    const profile = await fetchGoogleProfile(token.accessToken, config)
    const signup = await upsertSignup(profile, bindings)

    return redirect(new URL("/", publicOrigin(request)).toString(), 303, [
      clearState,
      cookie(sessionCookieName, signup.session_id, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        secure,
      }),
    ])
  } catch {
    return errorRedirect(request, "login_failed", [clearState])
  }
}
