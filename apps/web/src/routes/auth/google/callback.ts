import type { APIEvent } from "@solidjs/start/server"
import { finishGoogleAuth } from "../../../lib/googleAuth.ts"

export function GET(event: APIEvent): Promise<Response> {
  return finishGoogleAuth(event.request)
}
