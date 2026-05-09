import { createInertiaApp } from "inertia-adapter-solid"
import { render } from "solid-js/web"

type PageModule = {
  default: unknown
}

const pages = import.meta.glob<PageModule>("./pages/**/*.tsx")

void createInertiaApp({
  resolve: async name => {
    const loadPage = pages[`./pages/${name}.tsx`]
    if (loadPage === undefined) {
      throw new Error(`Inertia page ${name} is missing`)
    }

    return (await loadPage()).default
  },
  setup({ el, App, props }) {
    render(() => <App {...props} />, el)
  },
})
