import { describe, expect, test } from "bun:test"

import { loadConfig } from "./cmd.ts"

describe("loadConfig", () => {
  test("uses tcp defaults", () => {
    expect(loadConfig({})).toEqual({
      listener: "tcp",
      hostname: "127.0.0.1",
      port: 3000,
    })
  })

  test("uses explicit tcp config", () => {
    expect(loadConfig({
      RECURRING_SHEETS_HOST: "0.0.0.0",
      RECURRING_SHEETS_PORT: "4000",
    })).toEqual({
      listener: "tcp",
      hostname: "0.0.0.0",
      port: 4000,
    })
  })

  test("uses unix socket config", () => {
    expect(loadConfig({
      RECURRING_SHEETS_LISTENER_KIND: "unix",
      RECURRING_SHEETS_SOCKET_PATH: "/tmp/sheets.sock",
    })).toEqual({
      listener: "unix",
      path: "/tmp/sheets.sock",
    })
  })

  test("requires unix socket path", () => {
    expect(() => loadConfig({
      RECURRING_SHEETS_LISTENER_KIND: "unix",
    })).toThrow("RECURRING_SHEETS_SOCKET_PATH is required for unix listener")
  })
})
