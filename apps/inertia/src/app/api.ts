import type { EmailAddrStr } from "@recurring/shared-ts"
import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import type { Signup, SignupSession } from "../../gen/models/index.ts"
import { Configuration } from "../../gen/runtime.ts"
import { GoogleProfile } from "./google-auth.ts"

type HealthPayload = {
  status: string
}

export const apiOrigin = (bindings: Env): string =>
  bindings.RECURRING_API_ORIGIN.replace(/\/$/, "")

const api = (bindings: Env): DefaultApi =>
  new DefaultApi(new Configuration({ basePath: apiOrigin(bindings) }))

export const healthCheck = async (bindings: Env): Promise<HealthPayload> => {
  await api(bindings).healthCheck()
  return { status: "ok" }
}

export const upsertSignup = async (
  profile: GoogleProfile,
  bindings: Env,
): Promise<SignupSession> => {
  const signup: Signup = {
    google_sub: profile.sub,
    email: profile.email,
  }
  if (profile.name !== undefined) {
    signup.name = profile.name
  }
  if (profile.picture !== undefined) {
    signup.picture_url = profile.picture
  }

  return api(bindings).upsertSignup(signup)
}
