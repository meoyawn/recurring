import { isRecord, type EmailAddrStr } from "@recurring/shared-ts"
import { tracedRequest } from "@recurring/shared-ts/hono-tracing"

import { Paths } from "../paths.ts"
import type { HonoCtx } from "../worker.ts"
import { upsertSignup } from "./api.ts"
import {
  clearCookie,
  cookie,
  isSecureRequest,
  readCookie,
  sessionCookie,
} from "./session-cookie.ts"

type GoogleAuthConfig = {
  authorizationEndpoint: string
  clientId: string
  clientSecret: string
  redirectURI: string
  tokenEndpoint: string
  userinfoEndpoint: string
}

const googleStateCookieName = "googleOAuthState"

export type GoogleProfile = {
  sub: string
  email: EmailAddrStr
  name?: string
  picture?: string
}

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

const redirect = (
  location: string,
  status: 302,
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
  const url = new URL(Paths.home, publicOrigin(request))
  url.searchParams.set("auth", code)
  return redirect(url.toString(), 302, cookies)
}

const authConfig = (ctx: HonoCtx, callbackPath: string): GoogleAuthConfig => {
  const bindings = ctx.env
  if (
    bindings.GOOGLE_CLIENT_ID === undefined ||
    bindings.GOOGLE_CLIENT_SECRET === undefined
  ) {
    throw new Error("Google OAuth client credentials are required")
  }

  return {
    authorizationEndpoint: requiredBinding(
      bindings.GOOGLE_AUTHORIZATION_ENDPOINT,
      "GOOGLE_AUTHORIZATION_ENDPOINT",
    ),
    tokenEndpoint: requiredBinding(
      bindings.GOOGLE_TOKEN_ENDPOINT,
      "GOOGLE_TOKEN_ENDPOINT",
    ),
    userinfoEndpoint: requiredBinding(
      bindings.GOOGLE_USERINFO_ENDPOINT,
      "GOOGLE_USERINFO_ENDPOINT",
    ),
    clientId: bindings.GOOGLE_CLIENT_ID,
    clientSecret: bindings.GOOGLE_CLIENT_SECRET,
    redirectURI: new URL(
      callbackPath,
      publicOrigin(tracedRequest(ctx)),
    ).toString(),
  }
}

const requiredBinding = (value: string | undefined, name: string): string => {
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }
  return value
}

const randomState = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

const authorizationURL = (config: GoogleAuthConfig, state: string): string => {
  const url = new URL(config.authorizationEndpoint)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectURI)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid profile email")
  url.searchParams.set("state", state)
  url.searchParams.set("prompt", "select_account")
  return url.toString()
}

const exchangeAuthorizationCode = async (
  config: GoogleAuthConfig,
  code: string,
): Promise<string> => {
  const res = await fetch(config.tokenEndpoint, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectURI,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  })
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`)
  }

  const token = await res.json()
  if (!isRecord(token) || typeof token["access_token"] !== "string") {
    throw new Error("Google token response is invalid")
  }
  return token["access_token"]
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
  ctx: HonoCtx,
  callbackPath: string,
): Promise<Response> => {
  const request = tracedRequest(ctx)
  try {
    const config = authConfig(ctx, callbackPath)
    const state = randomState()

    return redirect(authorizationURL(config, state), 302, [
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
  ctx: HonoCtx,
  callbackPath: string,
): Promise<Response> => {
  const request = tracedRequest(ctx)
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

    const config = authConfig(ctx, callbackPath)
    const accessToken = await exchangeAuthorizationCode(config, code)
    const profile = await fetchGoogleProfile(accessToken, config)
    const signup = await upsertSignup(profile)

    return redirect(
      new URL(Paths.home, publicOrigin(request)).toString(),
      302,
      [clearState, sessionCookie(signup.session_id, secure)],
    )
  } catch {
    return errorRedirect(request, "login_failed", [clearState])
  }
}
