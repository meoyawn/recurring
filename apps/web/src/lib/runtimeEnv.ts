"use server"

import { getRequestEvent } from "solid-js/web"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const workerBindings = (): Env | undefined => {
  const context = getRequestEvent()?.nativeEvent.context
  if (!isRecord(context)) {
    return undefined
  }

  const platform = context["_platform"]
  if (!isRecord(platform)) {
    return undefined
  }

  const cloudflare = platform.cloudflare
  if (!isRecord(cloudflare)) {
    return undefined
  }

  if (!isRecord(cloudflare.env)) {
    return undefined
  }

  return cloudflare.env as Env
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
