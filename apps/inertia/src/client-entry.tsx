/** Vite's dependency scanner reads this TSX entry before Solid transforms it. */
/* @jsxImportSource hono/jsx */
import { Script } from "vite-ssr-components/hono"

export const clientEntry = <Script src="/src/client.tsx" />
