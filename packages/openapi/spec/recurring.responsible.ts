#!/usr/bin/env bun
import {
  array,
  GET,
  httpSecurity,
  httpURL,
  isoDuration,
  object,
  POST,
  ref,
  resp,
  responsibleAPI,
  scope,
  unixMillis,
} from "@responsibleapi/ts"
import { YAML } from "bun"

import {
  Money,
  NonEmptyString,
  WorkbookExportResponse,
  WorkbookFormat,
} from "./shared.responsibe.ts"

export const DbTimestamps = () =>
  object({
    created_at: unixMillis,
    updated_at: unixMillis,
  })

const RecurringInterval = () =>
  isoDuration({
    description: "Subscription billing period length as an RFC 3339 duration.",
  })

const SessionSecurity = () =>
  httpSecurity({
    description:
      "API token security using the session-id header. Web auth remains cookie-based; callers pass the resolved session id to the API in this header.",
    scheme: "bearer",
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

const sessionAPI = scope({
  forEachOp: {
    req: {
      security: SessionSecurity,
    },
    res: {
      add: {
        401: resp({
          description: "Missing or invalid API token.",
        }),
      },
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
  "/exports/workbook": GET({
    id: "downloadWorkbookExport",
    description:
      "Download current user's recurring expense export as a workbook. Response is proxied through from the internal sheets service to preserve the generated file body and download headers.",
    req: {
      query: {
        "format?": WorkbookFormat,
      },
    },
    res: {
      200: WorkbookExportResponse,
    },
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
      "/signup": POST({
        id: "TODO",
      }),
      "/session": sessionAPI,
    }),
  },
})

console.log(YAML.stringify(api, null, 2))
