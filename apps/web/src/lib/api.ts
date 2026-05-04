"use server"

import { getCookie } from "@solidjs/start/http"
import { getRequestEvent } from "solid-js/web"

import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"

const sessionCookieName = "sessionID"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isWorkerEnv = (value: unknown): value is Env =>
  isRecord(value) && typeof value.RECURRING_API_ORIGIN === "string"

const workerBindings = (): Env | undefined => {
  const context = getRequestEvent()?.nativeEvent.context
  if (!isRecord(context)) {
    return undefined
  }

  const platform = context["_platform"]
  if (!isRecord(platform)) {
    return undefined
  }

  const cloudflare = platform.cloudflare
  if (!isRecord(cloudflare)) {
    return undefined
  }

  if (!isWorkerEnv(cloudflare.env)) {
    return undefined
  }

  return cloudflare.env
}

export const apiOrigin = (bindings: Env | undefined = workerBindings()) => {
  const origin = bindings?.RECURRING_API_ORIGIN
  if (!origin || origin.length === 0) {
    throw new Error("RECURRING_API_ORIGIN is required")
  }

  return origin.replace(/\/$/, "")
}

const getSessionID = () => getCookie(sessionCookieName)

const api = () =>
  new DefaultApi(
    new Configuration({
      accessToken: () => getSessionID() ?? "",
      basePath: apiOrigin(),
    }),
  )

export const apiGetter = async <T>(
  fn: (api: DefaultApi) => Promise<T>,
): Promise<T> => fn(api())
