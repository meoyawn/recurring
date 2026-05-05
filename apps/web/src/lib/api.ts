"use server"

import { getCookie } from "@solidjs/start/http"

import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"
import { runtimeEnv, workerBindings } from "./runtimeEnv.ts"

const sessionCookieName = "sessionID"

export const apiOrigin = (
  bindings: Env | undefined = workerBindings(),
) => {
  const origin = runtimeEnv("RECURRING_API_ORIGIN", bindings)
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
