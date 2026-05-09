"use server"

import type { APIEvent } from "@solidjs/start/server"
import { startGoogleAuth } from "../../../lib/googleAuth.ts"
import { eventBindings } from "../../../lib/runtimeEnv.ts"

export function GET(event: APIEvent): Response {
  return startGoogleAuth(event.request, eventBindings(event))
}
