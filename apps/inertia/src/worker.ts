import { inertia } from "@hono/inertia"
import {
  honoTracing,
  otlpTraceEndpointFromEnv,
} from "@recurring/shared-ts/hono-tracing"
import { Hono, type Context } from "hono"
import { healthCheck } from "./app/api.ts"
import { finishGoogleAuth, startGoogleAuth } from "./app/google-auth.ts"
import { readSessionID } from "./app/session-cookie.ts"
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
      return c.redirect(new URL(Paths.login, c.req.url).toString(), 302)
    }

    const health = await healthCheck(c)

    return c.render("Home", { health })
  })

  return app
}

export default mkApp()
