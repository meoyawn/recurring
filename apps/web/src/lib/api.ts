import { getRequestEvent } from "solid-js/web"
import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"

const sessionCookieName = "sessionID"

type WorkerBindings = {
  RECURRING_API_ORIGIN?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const workerBindings = (): WorkerBindings | undefined => {
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

  const env = cloudflare.env
  if (!isRecord(env)) {
    return undefined
  }

  return typeof env.RECURRING_API_ORIGIN === "string"
    ? { RECURRING_API_ORIGIN: env.RECURRING_API_ORIGIN }
    : {}
}

const apiOrigin = () => {
  const origin = workerBindings()?.RECURRING_API_ORIGIN
  return (origin && origin.length > 0 ? origin : "http://localhost:8080").replace(
    /\/$/,
    "",
  )
}

const readCookie = (request: Request, name: string): string | undefined => {
  const header = request.headers.get("cookie")
  if (!header) {
    return undefined
  }

  for (const pair of header.split(";")) {
    const [rawName, ...rawValue] = pair.trim().split("=")
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="))
    }
  }

  return undefined
}

const getSessionID = () => {
  const request = getRequestEvent()?.request
  return request ? readCookie(request, sessionCookieName) : undefined
}

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
