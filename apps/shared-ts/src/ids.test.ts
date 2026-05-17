import { describe, expect, test } from "bun:test"
import {
  expenseIDFromString,
  projectIDFromString,
  sessionIDFromString,
  userIDFromString,
} from "./ids.ts"

describe("userIDFromString", () => {
  test("accepts user ids with the backend prefix", () => {
    const userID = userIDFromString("usr_short")
    if (userID === undefined) {
      throw new Error("valid user id rejected")
    }

    expect(userID).toEqual("usr_short")
  })

  test("rejects malformed user ids", () => {
    expect(userIDFromString("user_short")).toEqual(undefined)
    expect(userIDFromString("USR_short")).toEqual(undefined)
  })
})

describe("sessionIDFromString", () => {
  test("accepts session ids with the backend prefix", () => {
    const sessionID = sessionIDFromString("sess_short")
    if (sessionID === undefined) {
      throw new Error("valid session id rejected")
    }

    expect(sessionID).toEqual("sess_short")
  })

  test("rejects malformed session ids", () => {
    expect(sessionIDFromString("session_short")).toEqual(undefined)
    expect(sessionIDFromString("SESS_short")).toEqual(undefined)
  })
})

describe("projectIDFromString", () => {
  test("accepts project ids with the backend prefix", () => {
    const projectID = projectIDFromString("prj_short")
    if (projectID === undefined) {
      throw new Error("valid project id rejected")
    }

    expect(projectID).toEqual("prj_short")
  })

  test("rejects malformed project ids", () => {
    expect(projectIDFromString("project_short")).toEqual(undefined)
    expect(projectIDFromString("PRJ_short")).toEqual(undefined)
  })
})

describe("expenseIDFromString", () => {
  test("accepts expense ids with the backend prefix", () => {
    const expenseID = expenseIDFromString("exp_short")
    if (expenseID === undefined) {
      throw new Error("valid expense id rejected")
    }

    expect(expenseID).toEqual("exp_short")
  })

  test("rejects malformed expense ids", () => {
    expect(expenseIDFromString("expense_short")).toEqual(undefined)
    expect(expenseIDFromString("EXP_short")).toEqual(undefined)
  })
})
