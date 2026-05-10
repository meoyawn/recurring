/// <reference types="@solidjs/start/env" />

import type { EmailAddrStr as SharedEmailAddrStr } from "@recurring/shared-ts"

declare global {
  type EmailAddrStr = SharedEmailAddrStr
}
