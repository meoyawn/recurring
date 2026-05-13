import type { EmailAddrStr as SharedEmailAddrStr } from "@recurring/shared-ts"

declare global {
  type EmailAddrStr = SharedEmailAddrStr

  /** Defined by Vite config `define.INERTIA_VERSION`. */
  const INERTIA_VERSION: string
}
