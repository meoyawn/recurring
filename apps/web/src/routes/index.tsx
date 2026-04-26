import { Title } from "@solidjs/meta"
import { createResource, Show } from "solid-js"

type HealthPayload = {
  status: string
}

const isHealthPayload = (value: unknown): value is HealthPayload =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  typeof value.status === "string"

export default function Home() {
  const [health] = createResource(true, async () => {
    const res = await fetch("/api/backend/v1/health")
    if (!res.ok) {
      throw new Error(`health: ${res.status}`)
    }
    const payload: unknown = await res.json()
    if (!isHealthPayload(payload)) {
      throw new Error("health: invalid response")
    }
    return payload
  })

  return (
    <main>
      <Title>Recurring</Title>
      <h1>Recurring</h1>
      <p>
        Same-origin API check (proxied to the Go API on the server in
        production; Vite proxy in dev):
      </p>
      <Show when={health.loading}>
        <p>Loading /api/backend/v1/health…</p>
      </Show>
      <Show when={health.error}>
        <p class="err">Error: {String(health.error)}</p>
      </Show>
      <Show when={health()}>
        {h => <pre class="health">{JSON.stringify(h(), null, 2)}</pre>}
      </Show>
    </main>
  )
}
