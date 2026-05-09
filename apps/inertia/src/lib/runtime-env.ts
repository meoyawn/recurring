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
