import { Title } from "@solidjs/meta"
import { cache, createAsync } from "@solidjs/router"
import { Show } from "solid-js"
import { apiGetter } from "~/lib/api.ts"

type HealthPayload = {
  status: string
}

const getHealth = cache(async (): Promise<HealthPayload> => {
  "use server"

  await apiGetter(api => api.healthCheck())
  return { status: "ok" }
}, "health")

export default function Home() {
  const health = createAsync(() => getHealth(), {
    deferStream: true,
  })

  return (
    <main>
      <Title>Recurring</Title>
      <h1>Recurring</h1>
      <p>
        Server API check (SolidStart server function calling the generated
        client):
      </p>
      <Show when={!health()}>
        <p>Loading /healthz...</p>
      </Show>
      <Show when={health()}>
        {h => <pre class="health">{JSON.stringify(h(), null, 2)}</pre>}
      </Show>
    </main>
  )
}
