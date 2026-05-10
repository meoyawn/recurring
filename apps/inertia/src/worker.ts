import { inertia } from "@hono/inertia"
import { Hono } from "hono"
import { healthCheck } from "./app/api.ts"
import { finishGoogleAuth, startGoogleAuth } from "./app/google-auth.ts"
import { rootView } from "./root-view.tsx"

const inertiaVersion = "recurring-inertia-1"

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>()

  app.use(inertia({ version: inertiaVersion, rootView }))

  app.get("/healthz", c => c.body(null, 200))

  {
    const googleAuthStartPath = "/auth/google/start"
    const googleAuthCallbackPath = "/auth/google/callback"

    app.get(googleAuthStartPath, c =>
      startGoogleAuth(c.req.raw, c.env, googleAuthCallbackPath),
    )
    app.get(googleAuthCallbackPath, c =>
      finishGoogleAuth(c.req.raw, c.env, googleAuthCallbackPath),
    )
  }

  app.get("/", async c => {
    const health = await healthCheck(c.req.raw, c.env)

    return c.render("Home", { health })
  })

  app.get("/status", async c => {
    const health = await healthCheck(c.req.raw, c.env)

    return c.render("Status", { health })
  })

  return app
}

export default createApp()
