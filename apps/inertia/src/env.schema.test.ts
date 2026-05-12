import { safeParse } from "valibot"
import { describe, expect, test } from "vitest"
import wranglerConfig from "../wrangler.toml"
import { envVarsSchema } from "./env.schema.ts"

describe("envVarsSchema", () => {
  test("validates Wrangler environment vars", () => {
    const environments = wranglerConfig.env as Record<string, { vars: unknown }>

    for (const env of Object.values(environments)) {
      expect(safeParse(envVarsSchema, env.vars).success).toEqual(true)
    }
  })
})
