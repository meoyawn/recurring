import { AsyncLocalStorage } from "node:async_hooks"
import {
  serviceClientContextFromHeaders,
  serviceFetch,
  setServiceClientContextHeaders,
  type HttpURL,
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
    const context = serviceClientContextFromHeaders(request.headers)

    const newHeaders = new Headers(init.headers)
    if (accessToken) {
      newHeaders.set("Authorization", `Bearer ${accessToken}`)
    }
    setServiceClientContextHeaders(newHeaders, context)

    return { init: { ...init, headers: newHeaders }, url }
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
