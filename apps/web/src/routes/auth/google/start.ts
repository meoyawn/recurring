import type { APIEvent } from "@solidjs/start/server";
import { startGoogleAuth } from "~/lib/googleAuth";

export function GET(event: APIEvent) {
  return startGoogleAuth(event);
}
