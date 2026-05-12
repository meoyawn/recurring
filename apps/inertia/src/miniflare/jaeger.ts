import { delay, isRecord } from "@recurring/shared-ts"

const jaegerQueryOrigin = "http://jaeger.localhost:16686"

const containsTraceID = (value: unknown, traceID: string): boolean => {
  if (typeof value === "string") {
    return value === traceID
  }
  if (Array.isArray(value)) {
    return value.some(item => containsTraceID(item, traceID))
  }
  if (isRecord(value)) {
    return Object.values(value).some(item => containsTraceID(item, traceID))
  }

  return false
}

const jaegerTraceExists = async (traceID: string): Promise<boolean> => {
  const response = await fetch(`${jaegerQueryOrigin}/api/v3/traces/${traceID}`)
  if (!response.ok) {
    return false
  }

  return containsTraceID(await response.json(), traceID)
}

const waitForJaegerTraceAttempt = async (
  traceID: string,
  attempt: number,
): Promise<void> => {
  if (await jaegerTraceExists(traceID)) {
    return
  }
  if (attempt >= 50) {
    throw new Error(`Jaeger trace ${traceID} lookup failed`)
  }

  await delay(100)
  await waitForJaegerTraceAttempt(traceID, attempt + 1)
}

export const waitForJaegerTrace = async (traceID: string): Promise<void> =>
  waitForJaegerTraceAttempt(traceID, 1)
