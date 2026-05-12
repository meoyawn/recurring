import { Events, OAuth2Server } from "oauth2-mock-server"

import { mockAuthServerURL } from "../config/wrangler.toml.ts"

const startOAuth2MockServer = async (): Promise<OAuth2Server> => {
  const oauthOrigin = mockAuthServerURL()
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
  await server.start(
    Number.parseInt(oauthOrigin.port, 10),
    oauthOrigin.hostname,
  )
  return server
}

export default async (): Promise<() => Promise<void>> => {
  const oauthServer = await startOAuth2MockServer()

  return async (): Promise<void> => {
    await oauthServer.stop()
  }
}
