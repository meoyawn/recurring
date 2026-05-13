const userIDPattern = /^usr_[0-9a-f]{32}$/

export type UserID = `usr_${string}`

const isUserID = (id: string): id is UserID => userIDPattern.test(id)

export const userIDFromString = (id: string): UserID | undefined => {
  if (!isUserID(id)) {
    return undefined
  }

  return id
}

export const userIDString = (id: UserID): string => id
