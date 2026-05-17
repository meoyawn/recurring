import type { SessionID } from "@recurring/shared-ts"
import { cookie, readCookie } from "../cookie.ts"

export const sessionCookieName = "sessionID"
const sessionCookieMaxAge = 60 * 60 * 24 * 30

export const sessionCookie = (sessionID: SessionID, secure: boolean): string =>
  cookie(sessionCookieName, sessionID, {
    maxAge: sessionCookieMaxAge,
    secure,
  })

export const readSessionID = (request: Request): string | undefined =>
  readCookie(request, sessionCookieName)
