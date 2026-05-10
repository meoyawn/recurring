import type { JSX } from "solid-js"
import { WebPath } from "../paths.ts"

export default function Login(): JSX.Element {
  return (
    <main>
      <form action={WebPath.googleAuthStart} method="get">
        <button type="submit">Sign in with Google</button>
      </form>
    </main>
  )
}
