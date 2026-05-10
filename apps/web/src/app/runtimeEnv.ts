"use server"

export const runtimeEnv = (
  name: keyof Env,
  bindings?: Env,
): string | undefined => {
  const binding = bindings?.[name]
  if (binding && binding.length > 0) {
    return binding
  }

  const processBinding = process.env[name]
  if (processBinding && processBinding.length > 0) {
    return processBinding
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
