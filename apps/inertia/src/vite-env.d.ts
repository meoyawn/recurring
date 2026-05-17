import type {
  EmailAddrStr as SharedEmailAddrStr,
  SessionID as SharedSessionID,
} from "@recurring/shared-ts"

/**
 * OpenAPI generator emits mapped schema names in apps/inertia/gen without
 * imports; keep these aliases in sync with packages/openapi/config/recurring-ts-fetch.yaml.
 */
declare global {
  type EmailAddrStr = SharedEmailAddrStr
  type SessionID = SharedSessionID

  /** Defined by Vite config `define.INERTIA_VERSION`. */
  const INERTIA_VERSION: string
}
