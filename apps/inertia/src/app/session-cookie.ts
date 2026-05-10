export const sessionCookieName = "sessionID"

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

export const readSessionID = (request: Request): string | undefined =>
  readCookie(request, sessionCookieName)
