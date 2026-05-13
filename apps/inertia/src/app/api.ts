import { serviceFetch, type ServiceClientContext } from "@recurring/shared-ts"
import { tracedRequest } from "@recurring/shared-ts/hono-tracing"
import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import type { Signup, SignupSession } from "../../gen/models/index.ts"
import { Configuration } from "../../gen/runtime.ts"
import type { EnvVars } from "../config/env.schema.ts"
import type { HonoCtx } from "../worker.ts"
import type { GoogleProfile } from "./google-auth.ts"
import { readSessionID } from "./session-cookie.ts"

type HealthPayload = {
  status: string
}

const requiredBinding = (value: string | undefined, name: string): string => {
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }
  return value
}

export const apiOrigin = (bindings: EnvVars): string =>
  requiredBinding(
    bindings.RECURRING_API_ORIGIN,
    "RECURRING_API_ORIGIN",
  ).replace(/\/$/, "")

const headerValue = (request: Request, name: string): string | undefined => {
  const value = request.headers.get(name)
  return value === null ? undefined : value
}

const serviceClientContextFromRequest = (
  request: Request,
): ServiceClientContext => {
  const context: ServiceClientContext = {}
  const traceparent = headerValue(request, "traceparent")
  if (traceparent !== undefined) {
    context.traceparent = traceparent
  }
  const tracestate = headerValue(request, "tracestate")
  if (tracestate !== undefined) {
    context.tracestate = tracestate
  }
  const requestID = headerValue(request, "x-request-id")
  if (requestID !== undefined) {
    context.requestID = requestID
  }
  const idempotencyKey = headerValue(request, "idempotency-key")
  if (idempotencyKey !== undefined) {
    context.idempotencyKey = idempotencyKey
  }

  return context
}

/**
 * Creates a fresh API client for each request instead of caching one, so
 * request-scoped auth and tracing context stay bound to the current request
 * without depending on Cloudflare Workers cache behavior.
 */
function api(ctx: HonoCtx): DefaultApi {
  const req = tracedRequest(ctx)

  return new DefaultApi(
    new Configuration({
      accessToken: readSessionID(req),
      basePath: apiOrigin(ctx.env),
      fetchApi: serviceFetch({ context: serviceClientContextFromRequest(req) }),
    }),
  )
}

export const healthCheck = async (ctx: HonoCtx): Promise<HealthPayload> => {
  await api(ctx).healthCheck()
  return { status: "ok" }
}

export const upsertSignup = async (
  ctx: HonoCtx,
  profile: GoogleProfile,
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

  return api(ctx).upsertSignup(signup)
}
