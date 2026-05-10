"use server"

import type { APIEvent } from "@solidjs/start/server"
import { eventBindings } from "../../../app/bindings.ts"
import { startGoogleAuth } from "../../../app/googleAuth.ts"

export function GET(event: APIEvent): Promise<Response> {
  return startGoogleAuth(event.request, eventBindings(event))
}
