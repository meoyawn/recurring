import { serializePage, type RootView } from "@hono/inertia"
import { renderToString } from "hono/jsx/dom/server"
import { Script, ViteClient } from "vite-ssr-components/hono"

const clientAssets = (): string => `${renderToString(ViteClient())}
    ${renderToString(Script({ src: "/src/client.tsx" }))}`

export const rootView: RootView = page => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" />
    ${clientAssets()}
  </head>
  <body>
    <script data-page="app" type="application/json">${serializePage(page)}</script>
    <div id="app"></div>
  </body>
</html>`
