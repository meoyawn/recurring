import { isHttpURL } from "@recurring/shared-ts"
import * as v from "valibot"

const httpURL = v.pipe(v.string(), v.url(), v.guard(isHttpURL))

export const envVarsSchema = v.strictObject({
  /** This repo is open source, so avoid leaking the API server origin. */
  RECURRING_API_ORIGIN: v.optional(httpURL),
  RECURRING_WEB_ORIGIN: httpURL,

  GOOGLE_AUTHORIZATION_ENDPOINT: httpURL,
  GOOGLE_TOKEN_ENDPOINT: httpURL,
  GOOGLE_USERINFO_ENDPOINT: httpURL,

  GOOGLE_CLIENT_ID: v.optional(v.string()),
  GOOGLE_CLIENT_SECRET: v.optional(v.string()),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpURL,
})

export type EnvVars = v.InferOutput<typeof envVarsSchema>
