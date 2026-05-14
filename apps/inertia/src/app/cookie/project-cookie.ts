import { isProjectID, type ProjectID } from "@recurring/shared-ts"

import { cookie, readCookie } from "../cookie.ts"

const lastProjectIDCookieName = "lastProjectID"
const lastProjectIDCookieMaxAge = 60 * 60 * 24 * 365

export const lastProjectIDCookie = (
  projectID: ProjectID,
  secure: boolean,
): string =>
  cookie(lastProjectIDCookieName, projectID, {
    path: "/",
    maxAge: lastProjectIDCookieMaxAge,
    secure,
  })

export const readLastProjectID = (request: Request): ProjectID | undefined => {
  const projectID = readCookie(request, lastProjectIDCookieName)
  if (projectID === undefined || !isProjectID(projectID)) {
    return undefined
  }

  return projectID
}
