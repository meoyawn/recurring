import * as v from "valibot"

const httpURL = v.pipe(
  v.string(),
  v.url(),
  v.check(value => ["http:", "https:"].includes(new URL(value).protocol)),
)

export const envVarsSchema = v.strictObject({
  RECURRING_API_ORIGIN: httpURL,
  GOOGLE_AUTHORIZATION_ENDPOINT: httpURL,
  GOOGLE_TOKEN_ENDPOINT: httpURL,
  GOOGLE_USERINFO_ENDPOINT: httpURL,
  GOOGLE_CLIENT_ID: v.optional(v.string()),
  GOOGLE_CLIENT_SECRET: v.optional(v.string()),
  OTEL_EXPORTER_OTLP_ENDPOINT: httpURL,
})

export type EnvVars = v.InferOutput<typeof envVarsSchema>
