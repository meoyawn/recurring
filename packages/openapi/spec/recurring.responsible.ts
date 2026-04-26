import {
  array,
  httpURL,
  int64,
  isoDuration,
  object,
  ref,
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

export const DbTimestamps = () =>
  object({
    created_at: unixMillis,
    updated_at: unixMillis,
  })

const RecurringInterval = () =>
  isoDuration({
    description: "Subscription billing period length as an RFC 3339 duration.",
  })

const Expense = () =>
  object({
    name: NonEmptyString,
    money: Money,
    recurring: RecurringInterval,
    started_at: ref(unixMillis, { description: "when Subscription start" }),
    "category?": NonEmptyString,
    "comment?": NonEmptyString,
    "cancel_url?": httpURL,
    "canceled_at?": ref(unixMillis, {
      description: "when Subscription was canceled",
    }),
  })

const CreateExpense = () =>
  object({
    started_at: ref(unixMillis, { description: "when Subscription start" }),
    name: NonEmptyString,
    money: Money,
    recurring: RecurringInterval,
    "category?": NonEmptyString,
    "comment?": NonEmptyString,
    "cancel_url?": httpURL,
    "canceled_at?": ref(unixMillis, {
      description: "when Subscription was canceled",
    }),
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
        req: {
          mime: "application/json",
        },
        res: {
          mime: "application/json",
        },
      },
      "/expenses": scope({
        GET: {
          id: "listExpenses",
          res: {
            200: array(Expense, { minItems: 0 }),
          },
        },
        POST: {
          id: "createExpense",
          req: CreateExpense,
          res: {
            201: Expense,
          },
        },
      }),
    }),
  },
})

console.log(YAML.stringify(api, null, 2))
