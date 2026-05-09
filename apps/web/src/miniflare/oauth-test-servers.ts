import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { Events, OAuth2Server } from "oauth2-mock-server"

type SignupRequest = {
  body: unknown
}

const tokenRequests: unknown[] = []
const signupRequests: SignupRequest[] = []

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: string[] = []
  for await (const chunk of request) {
    chunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    )
  }

  return chunks.join("")
}

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "localhost", () => {
      server.off("error", reject)
      resolve()
    })
  })

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

const writeJSON = (response: ServerResponse, body: unknown) => {
  response.writeHead(200, { "Content-Type": "application/json" })
  response.end(JSON.stringify(body))
}

const handleSignupRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.method === "POST" && request.url === "/__reset") {
    tokenRequests.length = 0
    signupRequests.length = 0
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === "GET" && request.url === "/__requests") {
    writeJSON(response, { signupRequests, tokenRequests })
    return
  }

  if (request.method !== "POST" || request.url !== "/v1/signup") {
    response.writeHead(404)
    response.end()
    return
  }

  signupRequests.push({ body: JSON.parse(await readRequestBody(request)) })
  writeJSON(response, { session_id: "sess_test" })
}

const startOAuth2MockServer = async () => {
  const server = new OAuth2Server()
  await server.issuer.keys.generate("RS256")
  server.service.on(Events.BeforeResponse, (_response, request) => {
    tokenRequests.push(request.body)
  })
  server.service.on(Events.BeforeUserinfo, userInfoResponse => {
    userInfoResponse.body = {
      sub: "google-sub-123",
      email: "person@example.test",
      name: "Person Example",
      picture: "https://example.test/avatar.png",
    }
  })
  await server.start(8081, "localhost")
  return server
}

export default async (): Promise<() => Promise<void>> => {
  const oauthServer = await startOAuth2MockServer()
  const signupServer = createServer(handleSignupRequest)
  await listen(signupServer, 8082)

  return async (): Promise<void> => {
    try {
      await oauthServer.stop()
    } finally {
      await close(signupServer)
    }
  }
}
