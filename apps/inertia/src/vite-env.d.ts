/// <reference types="vite/client" />

import type { EmailAddrStr as SharedEmailAddrStr } from "@recurring/shared-ts"

declare global {
  type EmailAddrStr = SharedEmailAddrStr
}
