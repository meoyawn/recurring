import { AsyncLocalStorage } from "node:async_hooks"
import {
  serviceFetch,
  type HttpURL,
  type ServiceClientContext,
} from "@recurring/shared-ts"
import { tracedRequest } from "@recurring/shared-ts/hono-tracing"
import type { MiddlewareHandler } from "hono"
import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import type { Signup, SignupSession } from "../../gen/models/index.ts"
import { Configuration, type Middleware } from "../../gen/runtime.ts"
import type { EnvVars } from "../config/env.schema.ts"
import type { HonoCtx } from "../worker.ts"
import type { GoogleProfile } from "./google-auth.ts"
import { readSessionID } from "./session-cookie.ts"

type HealthPayload = {
  status: string
}

type ApiRequestContext = {
  ctx?: HonoCtx
}

const apiRequestContextStorage = new AsyncLocalStorage<ApiRequestContext>()

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

const apiClients = new Map<HttpURL, DefaultApi>()

export const apiContextMiddleware: MiddlewareHandler<{
  Bindings: EnvVars
}> = async (ctx, next) => {
  const store: ApiRequestContext = { ctx }

  await apiRequestContextStorage.run(store, async () => {
    try {
      await next()
    } finally {
      delete store.ctx
    }
  })
}

const apiHonoCtx = (): HonoCtx => {
  const ctx = apiRequestContextStorage.getStore()?.ctx
  if (!ctx) {
    throw new Error("API request context is missing")
  } else {
    return ctx
  }
}

const apiRequest = (): Request => tracedRequest(apiHonoCtx())

const requestScopedMiddleware: Middleware = {
  async pre({ init, url }) {
    const request = apiRequest()
    const accessToken = readSessionID(request)
    const context = serviceClientContextFromRequest(request)
    const headers = new Headers(init.headers)

    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`)
    }
    if (context.traceparent) {
      headers.set("traceparent", context.traceparent)
    }
    if (context.tracestate) {
      headers.set("tracestate", context.tracestate)
    }
    if (context.requestID) {
      headers.set("x-request-id", context.requestID)
    }
    if (context.idempotencyKey) {
      headers.set("idempotency-key", context.idempotencyKey)
    }

    return { init: { ...init, headers }, url }
  },
}

const cachedApi = (origin: HttpURL): DefaultApi => {
  const existing = apiClients.get(origin)
  if (existing !== undefined) {
    return existing
  }

  const client = new DefaultApi(
    new Configuration({
      basePath: origin,
      fetchApi: serviceFetch(),
      middleware: [requestScopedMiddleware],
    }),
  )
  apiClients.set(origin, client)
  return client
}

/**
 * Caches only origin-level API client state. Request-scoped auth and tracing
 * context is pulled from the Worker async-local Hono context.
 */
function getAPI(): DefaultApi {
  return cachedApi(apiHonoCtx().env.RECURRING_API_ORIGIN)
}

export const healthCheck = async (): Promise<HealthPayload> => {
  await getAPI().healthCheck()
  return { status: "ok" }
}

export const upsertSignup = async (
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

  return getAPI().upsertSignup(signup)
}
