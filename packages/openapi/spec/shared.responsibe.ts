import { string } from "@responsibleapi/ts"

export const NonEmptyString = () => string({ minLength: 1 })

export const CurrencyCode = () =>
  string({
    description: "ISO 4217 alpha currency code.",
    examples: ["USD", "EUR"],
    pattern: "^[A-Z]{3}$",
  })
