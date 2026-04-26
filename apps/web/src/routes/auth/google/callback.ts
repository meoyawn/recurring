import type { APIEvent } from "@solidjs/start/server"
import { finishGoogleAuth } from "~/lib/googleAuth"

export function GET(event: APIEvent) {
  return finishGoogleAuth(event)
}
