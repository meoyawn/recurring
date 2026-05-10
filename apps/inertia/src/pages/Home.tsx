import { Link } from "inertia-adapter-solid"
import type { JSX } from "solid-js"
import { Paths } from "../paths.ts"

type HealthPayload = {
  status: string
}

type HomeProps = {
  health: HealthPayload
}

export default function Home(props: HomeProps): JSX.Element {
  return (
    <main>
      <nav>
        <Link href={Paths.home}>Home</Link>
      </nav>
      <h1>Recurring</h1>
      <p>Server API check from a Worker-owned Inertia route:</p>
      <pre class="health">{JSON.stringify(props.health, null, 2)}</pre>
    </main>
  )
}
