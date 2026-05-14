export type UserID = `usr_${string}`
export type ProjectID = `prj_${string}`

const isUserID = (id: string): id is UserID => id.startsWith("usr_")

export const isProjectID = (id: unknown): id is ProjectID =>
  typeof id === "string" && id.startsWith("prj_")

export const userIDFromString = (id: string): UserID | undefined => {
  if (!isUserID(id)) {
    return undefined
  }

  return id
}

export const userIDString = (id: UserID): string => id

export const projectIDFromString = (id: string): ProjectID | undefined => {
  if (!isProjectID(id)) {
    return undefined
  }

  return id
}

export const projectIDString = (id: ProjectID): string => id
