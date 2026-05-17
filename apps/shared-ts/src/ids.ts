export type UserID = `usr_${string}`
export type SessionID = `sess_${string}`
export type ProjectID = `prj_${string}`

const isUserID = (id: string): id is UserID => id.startsWith("usr_")

export const isSessionID = (id: unknown): id is SessionID =>
  typeof id === "string" && id.startsWith("sess_")

export const isProjectID = (id: unknown): id is ProjectID =>
  typeof id === "string" && id.startsWith("prj_")

export const userIDFromString = (id: string): UserID | undefined => {
  if (!isUserID(id)) {
    return undefined
  }

  return id
}

export const sessionIDFromString = (id: string): SessionID | undefined => {
  if (!isSessionID(id)) {
    return undefined
  }

  return id
}

export const projectIDFromString = (id: string): ProjectID | undefined => {
  if (!isProjectID(id)) {
    return undefined
  }

  return id
}
