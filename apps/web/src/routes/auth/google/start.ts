"use server"

import type { APIEvent } from "@solidjs/start/server"
import { eventBindings } from "../../../lib/bindings.ts"
import { startGoogleAuth } from "../../../lib/googleAuth.ts"

export function GET(event: APIEvent): Promise<Response> {
  return startGoogleAuth(event.request, eventBindings(event))
}
