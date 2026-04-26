import type { APIEvent } from "@solidjs/start/server"
import { startGoogleAuth } from "~/lib/googleAuth.ts"

export function GET(event: APIEvent) {
  return startGoogleAuth(event.request)
}
