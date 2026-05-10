import { describe, expect, test } from "bun:test"

import { loadConfig } from "./cmd.ts"

describe("loadConfig", () => {
  test("requires listener config from environment", () => {
    expect(() => loadConfig({})).toThrow(
      "RECURRING_SHEETS_LISTENER_KIND must be tcp or unix",
    )
  })

  test("uses explicit tcp config", () => {
    expect(
      loadConfig({
        RECURRING_SHEETS_LISTENER_KIND: "tcp",
        RECURRING_SHEETS_HOST: "localhost",
        RECURRING_SHEETS_PORT: "4000",
      }),
    ).toEqual({
      listener: "tcp",
      hostname: "localhost",
      port: 4000,
    })
  })

  test("requires tcp host", () => {
    expect(() =>
      loadConfig({
        RECURRING_SHEETS_LISTENER_KIND: "tcp",
        RECURRING_SHEETS_PORT: "4000",
      }),
    ).toThrow("RECURRING_SHEETS_HOST is required for tcp listener")
  })

  test("uses unix socket config", () => {
    expect(
      loadConfig({
        RECURRING_SHEETS_LISTENER_KIND: "unix",
        RECURRING_SHEETS_SOCKET_PATH: "/tmp/sheets.sock",
      }),
    ).toEqual({
      listener: "unix",
      path: "/tmp/sheets.sock",
    })
  })

  test("requires unix socket path", () => {
    expect(() =>
      loadConfig({
        RECURRING_SHEETS_LISTENER_KIND: "unix",
      }),
    ).toThrow("RECURRING_SHEETS_SOCKET_PATH is required for unix listener")
  })
})
