import { inertia } from "@hono/inertia"
import {
  honoTracing,
  otlpTraceEndpointFromEnv,
  tracedRequest,
} from "@recurring/shared-ts/hono-tracing"
import { Hono } from "hono"
import { healthCheck } from "./app/api.ts"
import { finishGoogleAuth, startGoogleAuth } from "./app/google-auth.ts"
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

  app.get("/healthz", c => c.body(null, 200))

  {
    const googleAuthStartPath = "/auth/google/start"
    const googleAuthCallbackPath = "/auth/google/callback"

    app.get(googleAuthStartPath, c =>
      startGoogleAuth(tracedRequest(c), c.env, googleAuthCallbackPath),
    )
    app.get(googleAuthCallbackPath, c =>
      finishGoogleAuth(tracedRequest(c), c.env, googleAuthCallbackPath),
    )
  }

  app.get("/", async c => {
    const health = await healthCheck(tracedRequest(c), c.env)

    return c.render("Home", { health })
  })

  app.get("/status", async c => {
    const health = await healthCheck(tracedRequest(c), c.env)

    return c.render("Status", { health })
  })

  return app
}

export default createApp()
