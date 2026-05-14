import { Link } from "inertia-adapter-solid"
import type { JSX } from "solid-js"

import { Paths } from "../paths.ts"

export default function NotFound(): JSX.Element {
  return (
    <main>
      <nav>
        <Link href={Paths.home}>Home</Link>
      </nav>
      <h1>404: Page Not Found</h1>
      <p>Sorry, the page you are looking for could not be found.</p>
    </main>
  )
}
