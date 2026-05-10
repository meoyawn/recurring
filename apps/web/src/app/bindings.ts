import type { APIEvent } from "@solidjs/start/server"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const cloudflareEnv = (value: unknown): Env | undefined => {
  if (!isRecord(value) || !("env" in value)) {
    return undefined
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value.env as Env
}

export const eventBindings = (event: APIEvent): Env | undefined => {
  const context = event.nativeEvent.context
  if (!isRecord(context)) {
    return undefined
  }

  const directCF = cloudflareEnv(context.cloudflare)
  if (directCF) {
    return directCF
  }

  const platform = context._platform
  if (!isRecord(platform)) {
    return undefined
  }

  return cloudflareEnv(platform.cloudflare)
}
