import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import { mockAuthServerURL, wranglerVars } from "../config/wrangler.toml.ts"
import setupOAuth2MockServer from "./oauth2-mock-server.ts"

type ChildProcess = Bun.Subprocess<"ignore", "inherit", "inherit">

type GoogleOAuthEndpoints = Record<
  | "GOOGLE_AUTHORIZATION_ENDPOINT"
  | "GOOGLE_TOKEN_ENDPOINT"
  | "GOOGLE_USERINFO_ENDPOINT",
  string
>

type SpawnOptions = {
  cmd: string[]
  cwd?: string
  env: NodeJS.ProcessEnv
}

type WebTestEnvironment = {
  api: ChildProcess
  apiOrigin: string
  sheets: ChildProcess
}

const startupTimeoutMs = 20_000
const shutdownTimeoutMs = 5_000
const e2eDir = dirname(fileURLToPath(import.meta.url))
const inertiaDir = join(e2eDir, "..", "..")
const appsDir = join(inertiaDir, "..")
const apiDir = join(appsDir, "api")
const sheetsDir = join(appsDir, "sheets")

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

function googleOAuthEndpointURLs(oauthOrigin: URL): GoogleOAuthEndpoints {
  return {
    GOOGLE_AUTHORIZATION_ENDPOINT: new URL(
      "/authorize",
      oauthOrigin,
    ).toString(),
    GOOGLE_TOKEN_ENDPOINT: new URL("/token", oauthOrigin).toString(),
    GOOGLE_USERINFO_ENDPOINT: new URL("/userinfo", oauthOrigin).toString(),
  }
}

function workerTestEnv(
  apiOrigin: string,
  webOrigin: string,
  googleOAuthEndpoints: GoogleOAuthEndpoints,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...googleOAuthEndpoints,
    CLOUDFLARE_ENV: "development",
    RECURRING_API_ORIGIN: apiOrigin,
    RECURRING_CF_WORKER_TEST: "1",
    RECURRING_WEB_ORIGIN: webOrigin,
  }
}

function spawnInherited(options: SpawnOptions): ChildProcess {
  return Bun.spawn({
    cmd: options.cmd,
    cwd: options.cwd,
    env: options.env,
    stderr: "inherit",
    stdin: "ignore",
    stdout: "inherit",
  })
}

async function waitForHealthz(
  origin: string | URL,
  child: ChildProcess,
  deadline = Date.now() + startupTimeoutMs,
): Promise<void> {
  const url = new URL("/healthz", origin)

  if (Date.now() >= deadline) {
    throw new Error(`timed out waiting for ${url.toString()}`)
  }

  if (child.exitCode !== null) {
    throw new Error(`process exited with status ${child.exitCode}`)
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_000) })
    await res.body?.cancel()
    if (res.ok) {
      return
    }
  } catch {}

  await sleep(100)
  await waitForHealthz(origin, child, deadline)
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) {
    return
  }

  child.kill("SIGTERM")
  const shutdownTimeout = new Promise<undefined>(resolve => {
    setTimeout(() => resolve(undefined), shutdownTimeoutMs)
  })
  const gracefulExitCode = await Promise.race([child.exited, shutdownTimeout])

  if (gracefulExitCode !== undefined || child.exitCode !== null) {
    return
  }

  child.kill("SIGKILL")
  await child.exited
}

function sheetsEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    RECURRING_SHEETS_HOST: "127.0.0.1",
    RECURRING_SHEETS_LISTENER_KIND: "tcp",
    RECURRING_SHEETS_PORT: String(port),
  }
}

function apiConfig(apiPort: number, sheetsOrigin: string): string {
  return `api:
  listener:
    kind: tcp
    addr: 127.0.0.1:${apiPort}

db:
  host: localhost
  port: 5432
  name: recurring
  user: recurring
  password: not-a-secret
  sslmode: disable
  max_conns: 4

sheets:
  origin: ${sheetsOrigin}
  transport:
    kind: tcp
  timeout_ms: 30000
  max_attempts: 3

telemetry:
  otlp_endpoint: http://localhost:4318
`
}

function goEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    GOCACHE: join(apiDir, ".cache", "go-build"),
  }
}

async function startAPI(
  apiConfigPath: string,
  apiOrigin: string,
  deadline = Date.now() + startupTimeoutMs,
): Promise<ChildProcess> {
  if (Date.now() >= deadline) {
    throw new Error(`timed out waiting for ${apiOrigin}/healthz`)
  }

  const api = spawnInherited({
    cmd: ["go", "run", "./cmd/api"],
    cwd: apiDir,
    env: goEnv({ RECURRING_CONFIG: apiConfigPath }),
  })

  try {
    await waitForHealthz(apiOrigin, api, deadline)
    return api
  } catch (err) {
    await stopChild(api)
    if (Date.now() >= deadline) {
      throw err
    }
    return startAPI(apiConfigPath, apiOrigin, deadline)
  }
}

async function startWebTestEnvironment(
  tmpDirPath: string,
): Promise<WebTestEnvironment> {
  const sheetsPort = await freePort("127.0.0.1")
  const apiPort = await freePort("127.0.0.1")
  const sheetsOrigin = `http://127.0.0.1:${sheetsPort}`
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const apiConfigPath = join(tmpDirPath, "api.yaml")
  await writeFile(apiConfigPath, apiConfig(apiPort, sheetsOrigin))

  let api: ChildProcess | undefined
  let sheets: ChildProcess | undefined

  try {
    sheets = spawnInherited({
      cmd: ["bun", "src/cmd.ts"],
      cwd: sheetsDir,
      env: sheetsEnv(sheetsPort),
    })
    await waitForHealthz(sheetsOrigin, sheets)

    api = await startAPI(apiConfigPath, apiOrigin)

    return {
      api,
      apiOrigin,
      sheets,
    }
  } catch (err) {
    await stopChild(api)
    await stopChild(sheets)
    throw err
  }
}

function setProcessEnv(env: GoogleOAuthEndpoints): void {
  for (const [name, value] of Object.entries(env)) {
    process.env[name] = value
  }
}

async function runTestCommand(apiOrigin: string): Promise<number> {
  const cmd = process.argv.slice(2)
  if (cmd.length === 0) {
    throw new Error("webtestenv command is required")
  }

  const developmentVars = wranglerVars("development")
  const webOrigin = await withFreePort(
    new URL(developmentVars.RECURRING_WEB_ORIGIN),
  )
  const oauthOrigin = await withFreePort(mockAuthServerURL())
  const googleOAuthEndpoints = googleOAuthEndpointURLs(oauthOrigin)
  const env = workerTestEnv(
    apiOrigin,
    webOrigin.toString(),
    googleOAuthEndpoints,
  )
  setProcessEnv(googleOAuthEndpoints)

  const stopOAuth2MockServer = await setupOAuth2MockServer()
  const vite = spawnInherited({
    cmd: [
      "bun",
      "vite",
      "dev",
      "--host",
      webOrigin.hostname,
      "--port",
      webOrigin.port,
      "--strictPort",
    ],
    cwd: inertiaDir,
    env,
  })

  try {
    await waitForHealthz(webOrigin, vite)
    const testRunner = spawnInherited({
      cmd,
      cwd: inertiaDir,
      env,
    })
    return await testRunner.exited
  } finally {
    await stopChild(vite)
    await stopOAuth2MockServer()
  }
}

async function main(): Promise<number> {
  const tmpDirPath = await mkdtemp(join(tmpdir(), "recurring-webtestenv-"))
  let env: WebTestEnvironment | undefined

  try {
    env = await startWebTestEnvironment(tmpDirPath)
    return await runTestCommand(env.apiOrigin)
  } finally {
    await stopChild(env?.api)
    await stopChild(env?.sheets)
    await rm(tmpDirPath, { force: true, recursive: true })
  }
}

try {
  process.exit(await main())
} catch (err) {
  const message =
    err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
