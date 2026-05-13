export type HttpURL = `http://${string}` | `https://${string}`

export function isHttpURL(value: string): value is HttpURL {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
