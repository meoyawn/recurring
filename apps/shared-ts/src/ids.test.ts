import { describe, expect, test } from "bun:test"
import { userIDFromString, userIDString } from "./ids.ts"

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
