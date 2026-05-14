import { AsyncLocalStorage } from "node:async_hooks"
import {
  isProjectID,
  serviceClientContextFromHeaders,
  serviceFetch,
  setServiceClientContextHeaders,
  type HttpURL,
  type ProjectID,
} from "@recurring/shared-ts"
import { tracedRequest } from "@recurring/shared-ts/hono-tracing"
import type { MiddlewareHandler } from "hono"
import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import type {
  Expense,
  Project,
  Signup,
  SignupSession,
} from "../../gen/models/index.ts"
import { Configuration, type Middleware } from "../../gen/runtime.ts"
import type { EnvVars } from "../config/env.schema.ts"
import type { HonoCtx } from "../worker.ts"
import { readSessionID } from "./cookie/session-cookie.ts"
import type { GoogleProfile } from "./google-auth.ts"

type ApiRequestContext = {
  ctx?: HonoCtx
}

const honoCtxALS = new AsyncLocalStorage<ApiRequestContext>()

const clientCache = new Map<HttpURL, DefaultApi>()

export const apiContextMiddleware: MiddlewareHandler<{
  Bindings: EnvVars
}> = async (ctx, next) => {
  const store: ApiRequestContext = { ctx }

  await honoCtxALS.run(store, async () => {
    try {
      await next()
    } finally {
      delete store.ctx
    }
  })
}

const getHonoCtx = (): HonoCtx => {
  const ctx = honoCtxALS.getStore()?.ctx
  if (!ctx) {
    throw new Error("API request context is missing")
  } else {
    return ctx
  }
}

const currentHonoReq = (): Request => tracedRequest(getHonoCtx())

const requestScopedMiddleware: Middleware = {
  async pre({ init, url }) {
    const request = currentHonoReq()
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
  const existing = clientCache.get(origin)
  if (existing) return existing

  const client = new DefaultApi(
    new Configuration({
      basePath: origin,
      fetchApi: serviceFetch(),
      middleware: [requestScopedMiddleware],
    }),
  )
  clientCache.set(origin, client)
  return client
}

/**
 * Caches only origin-level API client state. Request-scoped auth and tracing
 * context is pulled from the Worker async-local Hono context.
 */
function getAPI(): DefaultApi {
  const env = getHonoCtx().env
  const origin = env.RECURRING_API_ORIGIN
  if (!origin) {
    throw new Error(JSON.stringify(env))
  }
  return cachedApi(origin)
}

export const healthCheck = async (): Promise<{ status: string }> => {
  await getAPI().healthCheck()
  return { status: "ok" }
}

export const firstProjectID = async (): Promise<ProjectID> => {
  const projectID = await getAPI().firstProjectID()
  if (!isProjectID(projectID)) {
    throw new Error("API returned invalid project id")
  }
  return projectID
}

export const listProjects = async (): Promise<Project[]> =>
  getAPI().listProjects()

export const listExpenses = async (projectID: ProjectID): Promise<Expense[]> =>
  getAPI().listExpenses(projectID)

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
