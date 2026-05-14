export type HttpURL = `http://${string}` | `https://${string}`

export function isHttpURL(value: string): value is HttpURL {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function toHttpURL(url: URL): HttpURL | undefined {
  const str = url.toString()
  if (isHttpURL(str)) {
    return str
  } else {
    return undefined
  }
}
