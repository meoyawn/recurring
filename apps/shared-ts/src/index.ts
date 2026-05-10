/** String+email */
export type EmailAddrStr = `${string}@${string}.${string}`

export { honoTracing, otlpTraceEndpointFromEnv } from "./hono-tracing.ts"

export { delay, isRecord } from "./typescript.ts"

export {
  serviceFetch,
  type ServiceClientAttemptEvent,
  type ServiceClientContext,
  type ServiceClientErrorEvent,
  type ServiceClientOptions,
  type ServiceClientResponseEvent,
} from "./serviceclient.ts"
