"use server"

import type { APIEvent } from "@solidjs/start/server"
import { finishGoogleAuth } from "../../../lib/googleAuth.ts"
import { eventBindings } from "../../../lib/runtimeEnv.ts"

export function GET(event: APIEvent): Promise<Response> {
  return finishGoogleAuth(event.request, eventBindings(event))
}
