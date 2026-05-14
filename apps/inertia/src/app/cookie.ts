export type CookieOptions = {
  path?: string
  maxAge: number
  secure: boolean
}

export const isSecureRequest = (request: Request): boolean =>
  new URL(request.url).protocol === "https:"

export const cookie = (
  name: string,
  value: string,
  opts: CookieOptions,
): string => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ]
  if (opts.path !== undefined) {
    parts.splice(1, 0, `Path=${opts.path}`)
  }
  if (opts.secure) {
    parts.push("Secure")
  }
  return parts.join("; ")
}

export const clearCookie = (
  name: string,
  path: string,
  secure: boolean,
): string => cookie(name, "", { path, maxAge: 0, secure })

export const readCookie = (
  request: Request,
  name: string,
): string | undefined => {
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
