/** String+email */
export type EmailAddrStr = `${string}@${string}.${string}`

export { isHttpURL, type HttpURL } from "./web.ts"

export { honoTracing, otlpTraceEndpointFromEnv } from "./server/hono-tracing.ts"

export { delay, isRecord } from "./typescript.ts"

export {
  isProjectID,
  projectIDFromString,
  projectIDString,
  userIDFromString,
  userIDString,
  type ProjectID,
  type UserID,
} from "./ids.ts"

export {
  serviceClientContextFromHeaders,
  serviceFetch,
  setServiceClientContextHeaders,
  type ServiceClientAttemptEvent,
  type ServiceClientContext,
  type ServiceClientErrorEvent,
  type ServiceClientOptions,
  type ServiceClientResponseEvent,
} from "./serviceclient.ts"
