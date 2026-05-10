/** string+email */
export type EmailAddrStr = `${string}@${string}.${string}`

export { honoTracing, otlpTraceEndpointFromEnv } from "./hono-tracing.ts"

export {
  serviceFetch,
  type ServiceClientAttemptEvent,
  type ServiceClientContext,
  type ServiceClientErrorEvent,
  type ServiceClientOptions,
  type ServiceClientResponseEvent,
} from "./serviceclient.ts"

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
