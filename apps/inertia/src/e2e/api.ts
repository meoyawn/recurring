import type { EmailAddrStr, SessionID } from "@recurring/shared-ts"

import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"

const recurringAPIClient = (basePath: string): DefaultApi =>
  new DefaultApi(new Configuration({ basePath }))

export const recurringAPI = recurringAPIClient(
  requireEnv("RECURRING_API_ORIGIN"),
)

export async function createSessionID(
  signup: { email?: EmailAddrStr; googleSub?: string } = {},
): Promise<SessionID> {
  const unique = crypto.randomUUID()
  const googleSub = signup.googleSub ?? `google-${unique}`
  const email = signup.email ?? `e2e-${unique}@example.com`
  const payload = await recurringAPI.upsertSignup({
    google_sub: googleSub,
    email,
  })

  return payload.session_id
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }

  return value
}
