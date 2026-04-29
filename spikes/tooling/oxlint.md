# Oxlint Adoption Plan

## Goal

Adopt Oxlint as the monorepo linter for all TypeScript code.

The monorepo should treat TypeScript source files as the runtime source of
truth:

- Relative and alias imports must include source extensions.
- TypeScript modules must be imported as `.ts`.
- TSX modules must be imported as `.tsx`.
- Relative `.js`, `.jsx`, `.mjs`, and `.cjs` imports are forbidden.
- Package imports keep normal bare specifiers, for example
  `import { createSignal } from "solid-js"`.

## Current State

- Root `package.json` has `oxfmt`, but no root `oxlint`.
- `apps/web/package.json` already has `oxlint`.
- `apps/web/tsconfig.json` uses `allowJs: true`; this conflicts with the target
  state that everything in the monorepo is TypeScript.
- `packages/openapi/tsconfig.json` already uses
  `allowImportingTsExtensions: true`, `noEmit: true`, and
  `moduleResolution: "bundler"`.
- `packages/openapi` now imports local shared code with `.ts` suffixes.

## Target Root Config

Create `oxlint.config.ts` at repo root and make it the only Oxlint config.

Use the shape from
`/Users/adelnizamutdinov/projects/responsibleapi/oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint"

export default defineConfig({
  plugins: ["typescript", "import", "jsdoc"],
  categories: {
    correctness: "error",
    nursery: "off",
    pedantic: "off",
    perf: "warn",
    restriction: "off",
    style: "off",
    suspicious: "warn",
  },
  options: {
    reportUnusedDisableDirectives: "error",
    typeAware: true,
  },
  rules: {
    "import/extensions": [
      "error",
      "always",
      {
        checkTypeImports: true,
        ignorePackages: true,
      },
    ],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "^\\.{1,2}/.*\\.(?:js|jsx|mjs|cjs)$",
            message:
              "Use TypeScript source extensions in relative imports: .ts or .tsx.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.{ts,tsx}"],
      rules: {
        "typescript/consistent-type-imports": [
          "error",
          {
            fixStyle: "separate-type-imports",
            prefer: "type-imports",
          },
        ],
        "typescript/no-deprecated": "error",
        "typescript/no-restricted-types": [
          "error",
          {
            types: {
              any: "Use a specific type instead.",
            },
          },
        ],
        "typescript/no-unsafe-type-assertion": "error",
        "typescript/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
            destructuredArrayIgnorePattern: "^_",
            ignoreRestSiblings: true,
            varsIgnorePattern: "^_",
          },
        ],
        eqeqeq: ["error", "always"],
        "no-console": "error",
      },
    },
    {
      files: ["**/*.responsible.ts", "scripts/**/*.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["**/*.{test,spec}.ts", "**/*.{test,spec}.tsx"],
      rules: {
        "typescript/no-unsafe-type-assertion": "off",
      },
    },
    {
      files: ["**/gen/**/*.ts", "**/.nitro/**/*.ts", "**/.output/**/*.ts"],
      rules: {
        "typescript/no-deprecated": "off",
        "typescript/no-restricted-types": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/no-unused-vars": "off",
        "no-console": "off",
      },
    },
  ],
})
```

This is the import policy enforcement:

- `import/extensions` with `"always"` rejects extensionless imports such as
  `./shared.responsibe` and `~/routes/index`.
- `ignorePackages: true` keeps bare package imports valid.
- `checkTypeImports: true` applies the same extension rule to `import type`.
- `no-restricted-imports` rejects relative JavaScript suffixes, so `./foo.js`
  cannot satisfy the extension rule in TypeScript source.

Examples:

```ts
import { x } from "./x.ts"
import type { X } from "./x.ts"
import App from "./app.tsx"
import { createSignal } from "solid-js"
```

Forbidden:

```ts
import { x } from "./x"
import type { X } from "./x"
import { x } from "./x.js"
```

## Package Changes

Move Oxlint ownership to the monorepo root:

- Add `oxlint` to root `devDependencies`.
- Add `oxlint-tsgolint` to root `devDependencies` if `options.typeAware: true`
  is kept.
- Remove package-local `oxlint` from `apps/web` after root install works.
- Keep `oxfmt` at root.

Add root scripts:

```json
{
  "scripts": {
    "lint": "oxlint",
    "lint:fix": "oxlint --fix"
  }
}
```

## TypeScript Config Alignment

Every package should support source-extension imports:

- Set `allowImportingTsExtensions: true`.
- Set `noEmit: true` for app/script packages that run or bundle TypeScript
  directly.
- Keep `moduleResolution: "bundler"` for Bun, Vite, and SolidStart packages
  unless a package specifically needs Node's native resolver.
- Set `allowJs: false` everywhere unless a migration package still contains
  JavaScript.

Initial changes:

- Change `apps/web/tsconfig.json` from `allowJs: true` to `allowJs: false`.
- Keep `packages/openapi/tsconfig.json` on `moduleResolution: "bundler"`.

## Rollout

1. Add root `oxlint.config.ts`.
2. Add root `lint` and `lint:fix` scripts.
3. Install root `oxlint` and `oxlint-tsgolint`.
4. Run `bun run lint`.
5. Fix extensionless imports first.
6. Fix relative `.js` import suffixes next.
7. Fix or temporarily override generated-code findings.
8. Switch CI to run `bun run lint`.
9. Remove package-local Oxlint dependency from `apps/web`.

## Verification

Use these checks before enabling CI failure:

```sh
bun run lint
bun run lint -- --fix
bun run --cwd packages/openapi tsc
bun run --cwd apps/web build
```

Expected import enforcement test:

- Temporarily change `import { CurrencyCode } from "./shared.responsibe.ts"` to
  `import { CurrencyCode } from "./shared.responsibe"` in
  `packages/openapi/spec/sheets.responsible.ts`.
- `bun run lint` must fail on `import/extensions`.
- Change it to `./shared.responsibe.js`.
- `bun run lint` must fail on `no-restricted-imports`.

## References

- Oxlint configuration supports `oxlint.config.ts`, `plugins`, `categories`,
  `overrides`, and `options`: https://oxc.rs/docs/guide/usage/linter/config
- Oxlint type-aware linting uses `options.typeAware` and requires
  `oxlint-tsgolint`: https://oxc.rs/docs/guide/usage/linter/type-aware
- Oxlint `import/extensions` can require extensions, ignore package imports, and
  check type imports:
  https://oxc.rs/docs/guide/usage/linter/rules/import/extensions
- Oxlint `no-restricted-imports` supports static import restrictions:
  https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports
