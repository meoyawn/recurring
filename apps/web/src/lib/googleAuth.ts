const googleStateCookieName = "googleOAuthState"
const sessionCookieName = "sessionID"

type GoogleAuthConfig = {
  clientId: string
  clientSecret: string
  redirectURI: string
}

type CookieOptions = {
  path: string
  maxAge: number
  secure: boolean
}

type GoogleTokenResponse = {
  access_token: string
}

type GoogleProfile = {
  sub: string
  email: string
  name?: string
  picture?: string
}

type SignupResponse = {
  session_id: string
}

const env = (name: string) => {
  const global = globalThis as {
    process?: { env?: Record<string, string | undefined> }
  }
  const value = global.process?.env?.[name]
  return value && value.length > 0 ? value : undefined
}

const requiredEnv = (name: string) => {
  const value = env(name)
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const publicOrigin = (request: Request) => {
  const forwardedProto = request.headers.get("x-forwarded-proto")
  const forwardedHost = request.headers.get("x-forwarded-host")
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return new URL(request.url).origin
}

const isSecureRequest = (request: Request) =>
  new URL(request.url).protocol === "https:" || env("NODE_ENV") === "production"

const cookie = (name: string, value: string, opts: CookieOptions) => {
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

const clearCookie = (name: string, path: string, secure: boolean) =>
  cookie(name, "", { path, maxAge: 0, secure })

const readCookie = (request: Request, name: string): string | undefined => {
  const header = request.headers.get("cookie")
  if (!header) {
    return undefined
  }

  for (const pair of header.split(";")) {
    const [rawName, ...rawValue] = pair.trim().split("=")
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="))
    }
  }

  return undefined
}

const redirect = (
  location: string,
  status: 302 | 303,
  cookies: string[] = [],
) => {
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
) => {
  const url = new URL("/", publicOrigin(request))
  url.searchParams.set("auth", code)
  return redirect(url.toString(), 303, cookies)
}

const authConfig = (request: Request): GoogleAuthConfig => ({
  clientId: requiredEnv("GOOGLE_CLIENT_ID"),
  clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
  redirectURI:
    env("GOOGLE_REDIRECT_URI") ??
    new URL("/auth/google/callback", publicOrigin(request)).toString(),
})

const apiOrigin = () =>
  (env("RECURRING_API_ORIGIN") ?? "http://localhost:8080").replace(/\/$/, "")

const randomState = () => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}

const parseGoogleTokenResponse = (value: unknown): GoogleTokenResponse => {
  if (!isRecord(value) || typeof value.access_token !== "string") {
    throw new Error("Google token response is invalid")
  }

  return { access_token: value.access_token }
}

const parseGoogleProfile = (value: unknown): GoogleProfile => {
  if (
    !isRecord(value) ||
    typeof value.sub !== "string" ||
    typeof value.email !== "string"
  ) {
    throw new Error("Google profile response is invalid")
  }

  return {
    sub: value.sub,
    email: value.email,
    name: typeof value.name === "string" ? value.name : undefined,
    picture: typeof value.picture === "string" ? value.picture : undefined,
  }
}

const parseSignupResponse = (value: unknown): SignupResponse => {
  if (!isRecord(value) || typeof value.session_id !== "string") {
    throw new Error("Signup response is invalid")
  }

  return { session_id: value.session_id }
}

const exchangeCode = async (code: string, config: GoogleAuthConfig) => {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectURI,
  })

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`)
  }

  return parseGoogleTokenResponse(await res.json())
}

const fetchGoogleProfile = async (accessToken: string) => {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`)
  }

  return parseGoogleProfile(await res.json())
}

const upsertSignup = async (profile: GoogleProfile) => {
  const res = await fetch(`${apiOrigin()}/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      google_sub: profile.sub,
      email: profile.email,
      name: profile.name,
      picture_url: profile.picture,
    }),
  })
  if (!res.ok) {
    throw new Error(`Signup failed: ${res.status}`)
  }

  return parseSignupResponse(await res.json())
}

export const startGoogleAuth = (request: Request) => {
  try {
    const config = authConfig(request)
    const state = randomState()
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", config.clientId)
    url.searchParams.set("redirect_uri", config.redirectURI)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", "openid profile email")
    url.searchParams.set("state", state)
    url.searchParams.set("prompt", "select_account")

    return redirect(url.toString(), 302, [
      cookie(googleStateCookieName, state, {
        path: "/auth/google/callback",
        maxAge: 600,
        secure: isSecureRequest(request),
      }),
    ])
  } catch {
    return errorRedirect(request, "configuration_error")
  }
}

export const finishGoogleAuth = async (request: Request) => {
  const secure = isSecureRequest(request)
  const clearState = clearCookie(
    googleStateCookieName,
    "/auth/google/callback",
    secure,
  )

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

    const token = await exchangeCode(code, authConfig(request))
    const profile = await fetchGoogleProfile(token.access_token)
    const signup = await upsertSignup(profile)

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
