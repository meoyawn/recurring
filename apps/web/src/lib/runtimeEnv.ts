"use server"

import { getRequestEvent } from "solid-js/web"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const workerBindings = (): Env | undefined => {
  const cf = getRequestEvent()?.nativeEvent.context.cloudflare
  if (isRecord(cf) && "env" in cf) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return cf?.env as Env | undefined
  } else {
    return undefined
  }
}

export const runtimeEnv = (
  name: keyof Env,
  bindings: Env | undefined = workerBindings(),
) => {
  const binding = bindings?.[name]
  if (binding && binding.length > 0) {
    return binding
  }

  return undefined
}

export const requiredRuntimeEnv = (
  name: keyof Env,
  bindings: Env | undefined = workerBindings(),
) => {
  const value = runtimeEnv(name, bindings)
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}
