"use server"

import type { APIEvent } from "@solidjs/start/server"
import { eventBindings } from "../../../app/bindings.ts"
import { finishGoogleAuth } from "../../../app/googleAuth.ts"

export function GET(event: APIEvent): Promise<Response> {
  return finishGoogleAuth(event.request, eventBindings(event))
}
