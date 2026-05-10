"use server"

import type { APIEvent } from "@solidjs/start/server"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const eventBindings = (event: APIEvent): Env | undefined => {
  const context = event.nativeEvent.context
  if (!isRecord(context)) {
    return undefined
  }

  const directCF = context.cloudflare
  if (isRecord(directCF) && "env" in directCF) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return directCF.env as Env
  }

  return undefined
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
