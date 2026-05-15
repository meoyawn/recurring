import { Events, OAuth2Server } from "oauth2-mock-server"

import { mockAuthServerURL, wranglerVars } from "../config/wrangler.toml.ts"

type GoogleOAuthEndpointVars = Parameters<typeof mockAuthServerURL>[0]

function googleOAuthEndpointVars(): GoogleOAuthEndpointVars {
  const vars = wranglerVars("test")

  return {
    GOOGLE_AUTHORIZATION_ENDPOINT:
      process.env["GOOGLE_AUTHORIZATION_ENDPOINT"] ??
      vars.GOOGLE_AUTHORIZATION_ENDPOINT,
    GOOGLE_TOKEN_ENDPOINT:
      process.env["GOOGLE_TOKEN_ENDPOINT"] ?? vars.GOOGLE_TOKEN_ENDPOINT,
    GOOGLE_USERINFO_ENDPOINT:
      process.env["GOOGLE_USERINFO_ENDPOINT"] ?? vars.GOOGLE_USERINFO_ENDPOINT,
  }
}

const startOAuth2MockServer = async (): Promise<OAuth2Server> => {
  const oauthOrigin = mockAuthServerURL(googleOAuthEndpointVars())
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
