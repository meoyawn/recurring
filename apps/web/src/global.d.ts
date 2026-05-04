/// <reference types="@solidjs/start/env" />

import type { EmailAddress as SharedEmailAddress } from "@recurring/shared-ts"

declare global {
  type EmailAddress = SharedEmailAddress
}
