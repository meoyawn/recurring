import { describe, expect, test } from "bun:test"
import {
  projectIDFromString,
  projectIDString,
  userIDFromString,
  userIDString,
} from "./ids.ts"

describe("userIDFromString", () => {
  test("accepts user ids with the backend prefix and lowercase hex payload", () => {
    const userID = userIDFromString(
      "usr_00000000000000000000000000000000",
    )
    if (userID === undefined) {
      throw new Error("valid user id rejected")
    }

    expect(userIDString(userID)).toEqual("usr_00000000000000000000000000000000")
  })

  test("rejects malformed user ids", () => {
    expect(userIDFromString("usr_0000000000000000000000000000000")).toEqual(
      undefined,
    )
    expect(userIDFromString("usr_000000000000000000000000000000000")).toEqual(
      undefined,
    )
    expect(userIDFromString("usr_0000000000000000000000000000000g")).toEqual(
      undefined,
    )
    expect(userIDFromString("user_00000000000000000000000000000000")).toEqual(
      undefined,
    )
    expect(userIDFromString("USR_00000000000000000000000000000000")).toEqual(
      undefined,
    )
  })
})

describe("projectIDFromString", () => {
  test("accepts project ids with the backend prefix and lowercase hex payload", () => {
    const projectID = projectIDFromString(
      "prj_00000000000000000000000000000000",
    )
    if (projectID === undefined) {
      throw new Error("valid project id rejected")
    }

    expect(projectIDString(projectID)).toEqual(
      "prj_00000000000000000000000000000000",
    )
  })

  test("rejects malformed project ids", () => {
    expect(projectIDFromString("prj_0000000000000000000000000000000")).toEqual(
      undefined,
    )
    expect(projectIDFromString("prj_000000000000000000000000000000000")).toEqual(
      undefined,
    )
    expect(projectIDFromString("prj_0000000000000000000000000000000g")).toEqual(
      undefined,
    )
    expect(projectIDFromString("project_00000000000000000000000000000000")).toEqual(
      undefined,
    )
    expect(projectIDFromString("PRJ_00000000000000000000000000000000")).toEqual(
      undefined,
    )
  })
})
