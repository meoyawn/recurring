#!/usr/bin/env bun
import {
  array,
  httpURL,
  number,
  object,
  POST,
  responsibleAPI,
  string,
} from "@responsibleapi/ts"
import { YAML } from "bun"

const NonEmptyString = () => string({ minLength: 1 })

const CurrencyCode = () =>
  string({
    description: "ISO 4217 alpha currency code.",
    examples: ["USD", "EUR"],
    pattern: "^[A-Z]{3}$",
  })

const Cadence = () =>
  string({
    description: "Recurring expense cadence used by spreadsheet formulas.",
    enum: ["weekly", "monthly", "quarterly", "yearly"],
  })

const ISODate = () =>
  string({
    description: "Calendar date in ISO 8601 YYYY-MM-DD format.",
    examples: ["2026-05-01"],
    format: "date",
  })

const DateTime = () =>
  string({
    description: "Timestamp in RFC 3339 date-time format.",
    examples: ["2026-04-26T00:00:00Z"],
    format: "date-time",
  })

const ExportExpense = () =>
  object({
    id: NonEmptyString,
    name: NonEmptyString,
    amount: number({
      description: "Expense amount in major currency units as shown in Sheets.",
      minimum: 0,
    }),
    currency: CurrencyCode,
    cadence: Cadence,
    nextDueDate: ISODate,
    "category?": NonEmptyString,
    createdAt: DateTime,
    updatedAt: DateTime,
  })

const GoogleSheetExportRequest = () =>
  object({
    userId: NonEmptyString,
    baseCurrency: CurrencyCode,
    expenses: array(ExportExpense, { minItems: 0 }),
  })

const GoogleSheetExportResponse = () =>
  object({
    spreadsheetId: NonEmptyString,
    url: httpURL,
  })

const api = responsibleAPI({
  partialDoc: {
    openapi: "3.1.0",
    info: {
      title: "Recurring Sheets Service API",
      version: "1",
    },
  },
  forEachOp: {
    req: {
      mime: "application/json",
    },
    res: {
      mime: "application/json",
    },
  },
  routes: {
    "/exports/google-sheet": POST("createGoogleSheetExport", {
      req: GoogleSheetExportRequest,
      res: {
        201: GoogleSheetExportResponse,
      },
    }),
  },
})

console.log(YAML.stringify(api, null, 2))
