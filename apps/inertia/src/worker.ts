import { inertia } from "@hono/inertia"
import { isProjectID } from "@recurring/shared-ts"
import {
  honoTracing,
  otlpTraceEndpointFromEnv,
} from "@recurring/shared-ts/hono-tracing"
import { Hono, type Context } from "hono"

import { ResponseError } from "../gen/runtime.ts"
import {
  apiContextMiddleware,
  firstProjectID,
  listExpenses,
  listProjects,
} from "./app/api.ts"
import { finishGoogleAuth, startGoogleAuth } from "./app/google-auth.ts"
import {
  lastProjectIDCookie,
  readLastProjectID,
} from "./app/cookie/project-cookie.ts"
import { isSecureRequest } from "./app/cookie.ts"
import { readSessionID } from "./app/cookie/session-cookie.ts"
import type { EnvVars } from "./config/env.schema.ts"
import { Paths } from "./paths.ts"
import { rootView } from "./root-view.tsx"

export type HonoCtx = Context<{ Bindings: EnvVars }>

const mkApp = (): Hono<{ Bindings: EnvVars }> => {
  const app = new Hono<{ Bindings: EnvVars }>()

  app.use(
    honoTracing<{ Bindings: EnvVars }>({
      serviceName: "recurring-inertia",
      traceEndpoint: c =>
        otlpTraceEndpointFromEnv({
          OTEL_EXPORTER_OTLP_ENDPOINT: c.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        }),
    }),
  )
  app.use(apiContextMiddleware)
  app.use(
    inertia({
      /** Inertia asset-version mismatch reloads only trigger for HTTP GET. */
      version: INERTIA_VERSION,
      rootView,
    }),
  )

  app.get(Paths.healthz, c => c.body(null, 200))

  app.get(Paths.googleAuthStart, c =>
    startGoogleAuth(c, Paths.googleAuthCallback),
  )
  app.get(Paths.googleAuthCallback, c =>
    finishGoogleAuth(c, Paths.googleAuthCallback),
  )

  app.get(Paths.login, c => c.render("Login"))

  app.get(Paths.home, async c => {
    if (readSessionID(c.req.raw) === undefined) {
      return c.redirect(new URL(Paths.login, c.req.url), 302)
    }

    const lastProjectID = readLastProjectID(c.req.raw)
    if (lastProjectID !== undefined) {
      return c.redirect(new URL(Paths.project(lastProjectID), c.req.url), 302)
    }

    try {
      const projectID = await firstProjectID()
      const location = new URL(Paths.project(projectID), c.req.url)

      return c.redirect(location, 302)
    } catch (err) {
      if (err instanceof ResponseError && err.response.status === 401) {
        return c.redirect(new URL(Paths.login, c.req.url), 302)
      }
      throw err
    }
  })

  app.get(Paths.project(":id"), async c => {
    if (readSessionID(c.req.raw) === undefined) {
      return c.redirect(new URL(Paths.login, c.req.url), 302)
    }

    const projectID = c.req.param("id")
    if (projectID === undefined || !isProjectID(projectID)) {
      return c.notFound()
    }

    try {
      const [projects, expenses] = await Promise.all([
        listProjects(),
        listExpenses(projectID),
      ])

      const secure = isSecureRequest(c.req.raw)
      c.header("Set-Cookie", lastProjectIDCookie(projectID, secure))
      return c.render("Project", { projects, expenses })
    } catch (err) {
      if (err instanceof ResponseError && err.response.status === 401) {
        return c.redirect(new URL(Paths.login, c.req.url), 302)
      }
      throw err
    }
  })

  /** Render Hono+Inertia 403/404 pages by setting status before c.render(). */
  app.all("*", c => {
    c.status(404)
    return c.render("404")
  })

  return app
}

export default mkApp()
