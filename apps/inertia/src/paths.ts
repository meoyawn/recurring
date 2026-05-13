export type WebPathLiteral =
  | "/"
  | "/auth/google/callback"
  | "/auth/google/start"
  | "/healthz"
  | "/login"
  | `/projects/${string}`

export const Paths = {
  googleAuthCallback: "/auth/google/callback",
  googleAuthStart: "/auth/google/start",
  healthz: "/healthz",
  home: "/",
  login: "/login",
  project: (id: string): WebPathLiteral => `/projects/${id}`,
} as const satisfies Record<
  string,
  WebPathLiteral | ((x: string) => WebPathLiteral)
>
