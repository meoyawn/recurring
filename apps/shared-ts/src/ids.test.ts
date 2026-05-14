import { describe, expect, test } from "bun:test"
import {
  projectIDFromString,
  projectIDString,
  userIDFromString,
  userIDString,
} from "./ids.ts"

describe("userIDFromString", () => {
  test("accepts user ids with the backend prefix", () => {
    const userID = userIDFromString("usr_short")
    if (userID === undefined) {
      throw new Error("valid user id rejected")
    }

    expect(userIDString(userID)).toEqual("usr_short")
  })

  test("rejects malformed user ids", () => {
    expect(userIDFromString("user_short")).toEqual(undefined)
    expect(userIDFromString("USR_short")).toEqual(undefined)
  })
})

describe("projectIDFromString", () => {
  test("accepts project ids with the backend prefix", () => {
    const projectID = projectIDFromString("prj_short")
    if (projectID === undefined) {
      throw new Error("valid project id rejected")
    }

    expect(projectIDString(projectID)).toEqual("prj_short")
  })

  test("rejects malformed project ids", () => {
    expect(projectIDFromString("project_short")).toEqual(undefined)
    expect(projectIDFromString("PRJ_short")).toEqual(undefined)
  })
})
