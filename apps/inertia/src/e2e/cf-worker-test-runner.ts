import { createServer } from "node:net"
import { setTimeout as sleep } from "node:timers/promises"

import { mockAuthServerURL, wranglerVars } from "../config/wrangler.toml.ts"
import setupOAuth2MockServer from "./oauth2-mock-server.ts"

type ChildProcess = Bun.Subprocess<"ignore", "inherit", "inherit">

const startupTimeoutMs = 20_000
const shutdownTimeoutMs = 5_000

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }

  return value
}

async function freePort(hostname: string): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, hostname, () => resolve())
  })

  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error(`reserved non-tcp address ${String(address)}`)
  }

  await new Promise<void>((resolve, reject) => {
    server.close(err => {
      if (err === undefined) {
        resolve()
        return
      }

      reject(err)
    })
  })
  return address.port
}

async function withFreePort(url: URL): Promise<URL> {
  const nextURL = new URL(url)
  nextURL.port = String(await freePort(nextURL.hostname))
  return nextURL
}

function googleOAuthEndpointURLs(oauthOrigin: URL): Record<
  "GOOGLE_AUTHORIZATION_ENDPOINT" | "GOOGLE_TOKEN_ENDPOINT" | "GOOGLE_USERINFO_ENDPOINT",
  string
> {
  return {
    GOOGLE_AUTHORIZATION_ENDPOINT: new URL("/authorize", oauthOrigin).toString(),
    GOOGLE_TOKEN_ENDPOINT: new URL("/token", oauthOrigin).toString(),
    GOOGLE_USERINFO_ENDPOINT: new URL("/userinfo", oauthOrigin).toString(),
  }
}

function childEnv(
  webOrigin: string,
  googleOAuthEndpoints: ReturnType<typeof googleOAuthEndpointURLs>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...googleOAuthEndpoints,
    CLOUDFLARE_ENV: "development",
    RECURRING_API_ORIGIN: requireEnv("RECURRING_API_ORIGIN"),
    RECURRING_CF_WORKER_TEST: "1",
    RECURRING_WEB_ORIGIN: webOrigin,
  }
}

function spawnInherited(cmd: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return Bun.spawn({
    cmd,
    env,
    stderr: "inherit",
    stdout: "inherit",
  })
}

async function waitForHTTP(
  url: URL,
  child: ChildProcess,
  deadline = Date.now() + startupTimeoutMs,
): Promise<void> {
  if (Date.now() >= deadline) {
    throw new Error(`timed out waiting for ${url.toString()}`)
  }

  if (child.exitCode !== null) {
    throw new Error(`dev server exited with status ${child.exitCode}`)
  }

  try {
    const res = await fetch(url)
    await res.body?.cancel()
    if (res.ok) {
      return
    }
  } catch {
  }

  await sleep(100)
  await waitForHTTP(url, child, deadline)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  child.kill("SIGTERM")
  const gracefulExitCode = await Promise.race([
    child.exited,
    sleep(shutdownTimeoutMs).then(() => undefined),
  ])

  if (gracefulExitCode !== undefined || child.exitCode !== null) {
    return
  }

  child.kill("SIGKILL")
  await child.exited
}

async function main(): Promise<number> {
  const developmentVars = wranglerVars("development")
  const webOrigin = await withFreePort(new URL(developmentVars.RECURRING_WEB_ORIGIN))
  const oauthOrigin = await withFreePort(mockAuthServerURL())
  const googleOAuthEndpoints = googleOAuthEndpointURLs(oauthOrigin)
  const env = childEnv(webOrigin.toString(), googleOAuthEndpoints)
  Object.assign(process.env, googleOAuthEndpoints)

  const stopOAuth2MockServer = await setupOAuth2MockServer()
  const vite = spawnInherited(
    [
      "bun",
      "vite",
      "dev",
      "--host",
      webOrigin.hostname,
      "--port",
      webOrigin.port,
      "--strictPort",
    ],
    env,
  )

  try {
    await waitForHTTP(new URL("/healthz", webOrigin), vite)
    const vitest = spawnInherited(
      [
        "bun",
        "vitest",
        "run",
        "--config",
        "vitest.e2e.config.ts",
        ...process.argv.slice(2),
      ],
      env,
    )
    return await vitest.exited
  } finally {
    await stopChild(vite)
    await stopOAuth2MockServer()
  }
}

process.exit(await main())
