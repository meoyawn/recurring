"use server"

import type { APIEvent } from "@solidjs/start/server"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const eventBindings = (event: APIEvent): Env | undefined => {
  const context = event.nativeEvent.context
  if (!isRecord(context)) {
    throw new Error("empty ctx")
  }

  const cf = context.cloudflare
  if (isRecord(cf) && "env" in cf) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return cf.env as Env
  }

  throw new Error(`CF bindings missing in ${JSON.stringify(event)}`)
}

export const runtimeEnv = (
  name: keyof Env,
  bindings?: Env,
): string | undefined => {
  const binding = bindings?.[name]
  if (binding && binding.length > 0) {
    return binding
  }

  return undefined
}

export const requiredRuntimeEnv = (name: keyof Env, bindings?: Env): string => {
  const value = runtimeEnv(name, bindings)
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}
