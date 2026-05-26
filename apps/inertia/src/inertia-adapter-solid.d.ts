import type { Page, PageProps, PageResolver } from "@inertiajs/core"
import type { Component, JSX, ParentComponent, ParentProps } from "solid-js"

type InertiaLayoutComponent = ParentComponent<Page["props"]>

type InertiaComponent = Component<Page["props"]> & {
  layout?: InertiaLayoutComponent | InertiaLayoutComponent[]
}

type InertiaAppProps<SharedProps extends PageProps = PageProps> = {
  initialPage: Page<SharedProps>
  initialComponent?: InertiaComponent
  resolveComponent?: PageResolver
}

/**
 * Works around inertia-adapter-solid 1.0.0-beta.7 declaring
 * createInertiaApp options.title as never even though @inertiajs/core accepts
 * title and the adapter runtime already tolerates the option.
 */
declare module "inertia-adapter-solid" {
  export function createInertiaApp<SharedProps extends PageProps = PageProps>(
    options: {
      page: Page<SharedProps>
      resolve: (
        name: string,
        page?: Page,
      ) => Component | Promise<Component> | { default: Component }
      setup(options: {
        el: HTMLElement | null
        App: Component<ParentProps<InertiaAppProps<SharedProps>>>
        props: ParentProps<InertiaAppProps<SharedProps>>
      }): JSX.Element | void
      title: string
    },
  ): Promise<void>
}
