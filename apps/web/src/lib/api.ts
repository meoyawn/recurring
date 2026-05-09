"use server"

import { getCookie } from "@solidjs/start/http"

import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"
import { runtimeEnv } from "./runtimeEnv.ts"

const sessionCookieName = "sessionID"

export const apiOrigin = (
  bindings?: Env,
): string => {
  const origin = runtimeEnv("RECURRING_API_ORIGIN", bindings)
  if (!origin || origin.length === 0) {
    throw new Error("RECURRING_API_ORIGIN is required")
  }

  return origin.replace(/\/$/, "")
}

const getSessionID = () => getCookie(sessionCookieName)

const api = (bindings?: Env) =>
  new DefaultApi(
    new Configuration({
      accessToken: () => getSessionID() ?? "",
      basePath: apiOrigin(bindings),
    }),
  )

export const apiGetter = async <T>(
  fn: (api: DefaultApi) => Promise<T>,
  bindings?: Env,
): Promise<T> => fn(api(bindings))
