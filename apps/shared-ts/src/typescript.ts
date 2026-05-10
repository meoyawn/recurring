export const delay = async (ms: number): Promise<void> => {
  if (ms === 0) {
    return
  }

  await new Promise(resolve => setTimeout(resolve, ms))
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
