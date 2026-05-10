import { rmSync } from "node:fs"
import {
  honoTracing,
  otlpTraceEndpointFromEnv,
} from "@recurring/shared-ts/hono-tracing"
import { Hono } from "hono"

type Config =
  | {
      listener: "tcp"
      hostname: string
      port: number
    }
  | {
      listener: "unix"
      path: string
    }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const listener = env["RECURRING_SHEETS_LISTENER_KIND"]
  if (listener === "unix") {
    const path = env["RECURRING_SHEETS_SOCKET_PATH"]
    if (!path) {
      throw new Error(
        "RECURRING_SHEETS_SOCKET_PATH is required for unix listener",
      )
    }
    return { listener, path }
  }
  if (listener === "tcp") {
    const hostname = env["RECURRING_SHEETS_HOST"]
    if (!hostname) {
      throw new Error("RECURRING_SHEETS_HOST is required for tcp listener")
    }
    const port = Number(env["RECURRING_SHEETS_PORT"])
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("RECURRING_SHEETS_PORT must be a TCP port")
    }
    return {
      listener,
      hostname,
      port,
    }
  }
  throw new Error("RECURRING_SHEETS_LISTENER_KIND must be tcp or unix")
}

export function start(config: Config = loadConfig()): Bun.Server<undefined> {
  const app = new Hono()

  app.use(
    honoTracing({
      deploymentEnvironment: () =>
        process.env["DEPLOYMENT_ENVIRONMENT"] ?? "local",
      serviceName: "recurring-sheets",
      traceEndpoint: () => otlpTraceEndpointFromEnv(process.env),
    }),
  )
  app.get("/healthz", c => c.body(null, 200))

  if (config.listener === "unix") {
    rmSync(config.path, { force: true })
    const server = Bun.serve({
      unix: config.path,
      fetch: app.fetch,
    })
    console.log(`sheets listening unix:${config.path}`)
    return server
  }

  const server = Bun.serve({
    hostname: config.hostname,
    port: config.port,
    fetch: app.fetch,
  })
  console.log(`sheets listening http://${server.hostname}:${server.port}`)
  return server
}

if (import.meta.main) {
  start()
}
