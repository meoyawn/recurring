import { Title } from "@solidjs/meta"
import type { JSX } from "solid-js"

export default function NotFound(): JSX.Element {
  return (
    <main>
      <Title>Not found</Title>
      <h1>404</h1>
      <p>That page does not exist.</p>
    </main>
  )
}
