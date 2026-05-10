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
import { WebPath } from "./paths.ts"
import { rootView } from "./root-view.tsx"

const inertiaVersion = "recurring-inertia-1"

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>()

  app.use(
    honoTracing<{ Bindings: Env }>({
      deploymentEnvironment: c => c.env.DEPLOYMENT_ENVIRONMENT,
      serviceName: "recurring-inertia",
      traceEndpoint: c =>
        otlpTraceEndpointFromEnv({
          OTEL_EXPORTER_OTLP_ENDPOINT: c.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        }),
    }),
  )
  app.use(inertia({ version: inertiaVersion, rootView }))

  app.get(WebPath.healthz, c => c.body(null, 200))

  app.get(WebPath.googleAuthStart, c =>
    startGoogleAuth(tracedRequest(c), c.env, WebPath.googleAuthCallback),
  )
  app.get(WebPath.googleAuthCallback, c =>
    finishGoogleAuth(tracedRequest(c), c.env, WebPath.googleAuthCallback),
  )

  app.get(WebPath.login, c => c.render("Login"))

  app.get(WebPath.home, async c => {
    if (readSessionID(c.req.raw) === undefined) {
      return c.redirect(new URL(WebPath.login, c.req.url).toString(), 302)
    }

    const health = await healthCheck(tracedRequest(c), c.env)

    return c.render("Home", { health })
  })

  return app
}

export default createApp()
