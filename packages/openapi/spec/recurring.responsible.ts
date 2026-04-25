import {
  GET,
  array,
  httpURL,
  int64,
  object,
  responsibleAPI,
  scope,
  string,
  unixMillis,
} from "@responsibleapi/ts"
import { YAML } from "bun"

const NonEmptyString = () => string({ minLength: 1 })

const CurrencyCode = () =>
  string({
    description: "ISO 4217 alpha currency code.",
    examples: ["USD", "EUR"],
    pattern: "^[A-Z]{3}$",
  })

const MinorUnitAmount = () =>
  int64({
    description: "Monetary value multiplied by 100.",
    minimum: 0,
  })

const Money = () =>
  object({
    amount: MinorUnitAmount,
    currency: CurrencyCode,
  })

const RecurringInterval = () =>
  string({
    description: "Subscription billing period length as an RFC 3339 duration.",
    examples: ["P1W", "P1Y"],
    format: "duration",
    minLength: 1,
  })

const Expense = () =>
  object({
    name: NonEmptyString,
    created_at: unixMillis,
    money: Money,
    recurring: RecurringInterval,
    "category?": NonEmptyString,
    "comment?": string(),
    "canceled_at?": unixMillis,
    "cancel_url?": httpURL,
  })

const api = responsibleAPI({
  partialDoc: {
    openapi: "3.1.0",
    info: {
      title: "Recurring API",
      version: "1",
    },
  },
  routes: {
    "/v1": scope({
      forEachOp: {
        res: {
          mime: "application/json",
        },
      },
      "/expenses": GET({
        id: "listExpenses",
        res: {
          200: array(Expense, { minItems: 0 }),
        },
      }),
    }),
  },
})

console.log(YAML.stringify(api, null, 2))
