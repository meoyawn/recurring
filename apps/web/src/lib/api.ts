import { getRequestEvent } from "solid-js/web"
import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"

const sessionCookieName = "sessionID"

type WorkerBindings = {
  RECURRING_API_ORIGIN?: string
}

type CloudflareContext = {
  _platform?: {
    cloudflare?: {
      env?: WorkerBindings
    }
  }
}

const workerBindings = () =>
  (getRequestEvent()?.nativeEvent.context as CloudflareContext | undefined)
    ?._platform?.cloudflare?.env

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
    return
  }

  for (const pair of header.split(";")) {
    const [rawName, ...rawValue] = pair.trim().split("=")
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="))
    }
  }
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
