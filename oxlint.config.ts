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
    "import/no-unassigned-import": [
      "warn",
      {
        allow: ["**/*.css"],
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
