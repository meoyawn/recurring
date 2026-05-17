export type UserID = `usr_${string}`
export type SessionID = `sess_${string}`
export type ProjectID = `prj_${string}`
export type ExpenseID = `exp_${string}`

export const isUserID = (id: unknown): id is UserID =>
  typeof id === "string" && id.startsWith("usr_")

export const isSessionID = (id: unknown): id is SessionID =>
  typeof id === "string" && id.startsWith("sess_")

export const isProjectID = (id: unknown): id is ProjectID =>
  typeof id === "string" && id.startsWith("prj_")

export const isExpenseID = (id: unknown): id is ExpenseID =>
  typeof id === "string" && id.startsWith("exp_")

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

export const expenseIDFromString = (id: string): ExpenseID | undefined => {
  if (!isExpenseID(id)) {
    return undefined
  }

  return id
}
