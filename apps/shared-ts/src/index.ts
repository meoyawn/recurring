/** String+email */
export type EmailAddrStr = `${string}@${string}.${string}`

export { isHttpURL, type HttpURL } from "./web.ts"

export { honoTracing, otlpTraceEndpointFromEnv } from "./server/hono-tracing.ts"

export { delay, isRecord } from "./typescript.ts"

export { userIDFromString, userIDString, type UserID } from "./ids.ts"

export {
  serviceFetch,
  type ServiceClientAttemptEvent,
  type ServiceClientContext,
  type ServiceClientErrorEvent,
  type ServiceClientOptions,
  type ServiceClientResponseEvent,
} from "./serviceclient.ts"
