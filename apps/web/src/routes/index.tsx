import { Title } from "@solidjs/meta";
import { createResource, Show } from "solid-js";

export default function Home() {
  const [health] = createResource(true, async () => {
    const res = await fetch("/api/backend/v1/health");
    if (!res.ok) {
      throw new Error(`health: ${res.status}`);
    }
    return res.json() as Promise<{ status: string }>;
  });

  return (
    <main>
      <Title>Recurring</Title>
      <h1>Recurring</h1>
      <p>Same-origin API check (proxied to the Go API on the server in production; Vite proxy in dev):</p>
      <Show when={health.loading}>
        <p>Loading /api/backend/v1/health…</p>
      </Show>
      <Show when={health.error}>
        <p class="err">Error: {String(health.error)}</p>
      </Show>
      <Show when={health()}>
        {(h) => <pre class="health">{JSON.stringify(h(), null, 2)}</pre>}
      </Show>
    </main>
  );
}
