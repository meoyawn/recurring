import { inertia } from "@hono/inertia"
import {
  honoTracing,
  otlpTraceEndpointFromEnv,
  tracedRequest,
} from "@recurring/shared-ts/hono-tracing"
import { Hono } from "hono"
import { healthCheck } from "./app/api.ts"
import { finishGoogleAuth, startGoogleAuth } from "./app/google-auth.ts"
import { readSessionID } from "./app/session-cookie.ts"
import { Paths } from "./paths.ts"
import { rootView } from "./root-view.tsx"

const inertiaVersion = "recurring-inertia-1"

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>()

  app.use(
    honoTracing<{ Bindings: Env }>({
      serviceName: "recurring-inertia",
      traceEndpoint: c =>
        otlpTraceEndpointFromEnv({
          OTEL_EXPORTER_OTLP_ENDPOINT: c.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        }),
    }),
  )
  app.use(inertia({ version: inertiaVersion, rootView }))

  app.get(Paths.healthz, c => c.body(null, 200))

  app.get(Paths.googleAuthStart, c =>
    startGoogleAuth(tracedRequest(c), c.env, Paths.googleAuthCallback),
  )
  app.get(Paths.googleAuthCallback, c =>
    finishGoogleAuth(tracedRequest(c), c.env, Paths.googleAuthCallback),
  )

  app.get(Paths.login, c => c.render("Login"))

  app.get(Paths.home, async c => {
    if (readSessionID(c.req.raw) === undefined) {
      return c.redirect(new URL(Paths.login, c.req.url).toString(), 302)
    }

    const health = await healthCheck(tracedRequest(c), c.env)

    return c.render("Home", { health })
  })

  return app
}

export default createApp()
