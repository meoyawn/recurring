import { Hono } from "hono"

const app = new Hono()

app.get("/healthz", c => c.body(null, 200))

export default app
