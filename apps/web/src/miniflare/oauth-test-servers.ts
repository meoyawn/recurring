import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import { Events, OAuth2Server } from "oauth2-mock-server"

const startOAuth2MockServer = async () => {
  const server = new OAuth2Server()
  await server.issuer.keys.generate("RS256")

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

  return async (): Promise<void> => {
    await oauthServer.stop()
  }
}
