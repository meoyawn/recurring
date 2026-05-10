import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { Events, OAuth2Server } from "oauth2-mock-server"

type CapturedAPIRequest = {
  headers: Record<string, string>
  method: string
  url: string
}

const apiCapturePort = 8083

const headerRecord = (headers: IncomingHttpHeaders): Record<string, string> => {
  const record: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      record[name] = value.join(", ")
    } else if (value !== undefined) {
      record[name] = value
    }
  }

  return record
}

const startOAuth2MockServer = async (): Promise<OAuth2Server> => {
  const server = new OAuth2Server()
  await server.issuer.keys.generate("RS256")

  server.service.on(Events.BeforeUserinfo, userInfoResponse => {
    const userId = crypto.randomUUID()

    userInfoResponse.body = {
      sub: `google-sub-${userId}`,
      email: `person-${userId}@example.test`,
      name: `Person ${userId}`,
      picture: `https://example.test/avatar-${userId}.png`,
    }
  })
  await server.start(8081, "localhost")
  return server
}

const startAPICaptureServer = async (): Promise<Server> => {
  let requests: CapturedAPIRequest[] = []
  const server = createServer((req, res) => {
    if (req.url === "/__reset") {
      requests = []
      res.writeHead(204)
      res.end()
      return
    }
    if (req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(requests))
      return
    }

    requests.push({
      headers: headerRecord(req.headers),
      method: req.method ?? "",
      url: req.url ?? "",
    })
    res.writeHead(200)
    res.end()
  })

  await new Promise<void>(resolve => {
    server.listen(apiCapturePort, "localhost", resolve)
  })
  return server
}

const stopAPICaptureServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

export default async (): Promise<() => Promise<void>> => {
  const oauthServer = await startOAuth2MockServer()
  const apiCaptureServer = await startAPICaptureServer()

  return async (): Promise<void> => {
    await stopAPICaptureServer(apiCaptureServer)
    await oauthServer.stop()
  }
}
