import type { createInertiaApp } from "inertia-adapter-solid"

type InitialPage = NonNullable<Parameters<typeof createInertiaApp>[0]["page"]>

export const parseInitialPage = (
  content: string | null,
  id: string,
): InitialPage => {
  if (content === null || content.length === 0) {
    throw new Error(`Inertia page payload for ${id} is missing`)
  }

  return JSON.parse(content)
}

/**
 * Bridges @hono/inertia's script-based initial page payload with
 * inertia-adapter-solid, which otherwise reads the payload from
 * #app.data-page.
 */
export const readInitialPage = (
  document: Document,
  id: string,
): InitialPage => {
  const pageElement = Array.from(
    document.querySelectorAll<HTMLScriptElement>(
      'script[data-page][type="application/json"]',
    ),
  ).find(element => element.dataset.page === id)

  return parseInitialPage(pageElement?.textContent ?? null, id)
}
