import { isRecord, type EmailAddrStr } from "@recurring/shared-ts"
import { upsertSignup } from "./api.ts"

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

const authConfig = (
  request: Request,
  bindings: Env,
  callbackPath: string,
): GoogleAuthConfig => {
  if (
    bindings.GOOGLE_CLIENT_ID === undefined ||
    bindings.GOOGLE_CLIENT_SECRET === undefined
  ) {
    throw new Error("Google OAuth client credentials are required")
  }

  return {
    authorizationEndpoint: bindings.GOOGLE_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: bindings.GOOGLE_TOKEN_ENDPOINT,
    userinfoEndpoint: bindings.GOOGLE_USERINFO_ENDPOINT,
    clientId: bindings.GOOGLE_CLIENT_ID,
    clientSecret: bindings.GOOGLE_CLIENT_SECRET,
    redirectURI:
      bindings.GOOGLE_REDIRECT_URI ||
      new URL(callbackPath, publicOrigin(request)).toString(),
  }
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
  request: Request,
  bindings: Env,
  callbackPath: string,
): Promise<Response> => {
  try {
    const config = authConfig(request, bindings, callbackPath)
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
    const accessToken = await exchangeAuthorizationCode(config, code)
    const profile = await fetchGoogleProfile(accessToken, config)
    const signup = await upsertSignup(request, profile, bindings)

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
