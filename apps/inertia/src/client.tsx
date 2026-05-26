import { createInertiaApp } from "inertia-adapter-solid"
import { createComponent, type Component, type JSX } from "solid-js"
import { render } from "solid-js/web"

import { AppStrings } from "./app-strings.ts"
import { readInitialPage } from "./initial-page.ts"

type PageModule = {
  default: Component
}

const pages = import.meta.glob<PageModule>("./pages/**/*.tsx")

void createInertiaApp({
  title: AppStrings.title,
  page: readInitialPage(document, "app"),
  resolve: async name => {
    const loadPage = pages[`./pages/${name}.tsx`]
    if (loadPage === undefined) {
      throw new Error(`Inertia page ${name} is missing`)
    }

    return (await loadPage()).default
  },
  setup({ el, App, props }) {
    if (el === null) {
      throw new Error("Inertia client root is missing")
    }

    render((): JSX.Element => createComponent(App, props), el)
  },
})
