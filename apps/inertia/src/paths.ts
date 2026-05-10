export type WebPathLiteral =
  | "/"
  | "/auth/google/callback"
  | "/auth/google/start"
  | "/healthz"
  | "/login"

export const WebPath = {
  googleAuthCallback: "/auth/google/callback",
  googleAuthStart: "/auth/google/start",
  healthz: "/healthz",
  home: "/",
  login: "/login",
} as const satisfies Record<
  string,
  WebPathLiteral | ((x: never) => WebPathLiteral)
>
