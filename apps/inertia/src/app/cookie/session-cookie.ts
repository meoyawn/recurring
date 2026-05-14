import { cookie, readCookie } from "../cookie.ts"

const sessionCookieName = "sessionID"
const sessionCookieMaxAge = 60 * 60 * 24 * 30

export const sessionCookie = (sessionID: string, secure: boolean): string =>
  cookie(sessionCookieName, sessionID, {
    maxAge: sessionCookieMaxAge,
    secure,
  })

export const readSessionID = (request: Request): string | undefined =>
  readCookie(request, sessionCookieName)
