import { Link } from "inertia-adapter-solid"
import type { JSX } from "solid-js"
import { Paths } from "../paths.ts"

type HealthPayload = {
  status: string
}

type StatusProps = {
  health: HealthPayload
}

export default function Status(props: StatusProps): JSX.Element {
  return (
    <main>
      <nav>
        <Link href={Paths.home}>Home</Link>
      </nav>
      <h1>Status</h1>
      <pre class="health">{JSON.stringify(props.health, null, 2)}</pre>
    </main>
  )
}
