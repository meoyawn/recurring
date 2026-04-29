#!/usr/bin/env bun
import {
  array,
  GET,
  isoDuration,
  object,
  POST,
  responsibleAPI,
  resp,
  string,
} from "@responsibleapi/ts"
import { YAML } from "bun"

import {
  CurrencyCode,
  Money,
  NonEmptyString,
  WorkbookExportResponse,
  WorkbookFormat,
} from "./shared.responsibe.ts"

const Cadence = () =>
  isoDuration({
    description: "Recurring interval used to render the workbook.",
    examples: ["P1M", "P1W", "P3Y"],
  })

const ISODate = () =>
  string({
    description:
      "Calendar date in ISO 8601 YYYY-MM-DD format, rendered as d MMM yyyy in the workbook.",
    examples: ["2026-05-01"],
    format: "date",
  })

const ExportRow = () =>
  object({
    name: NonEmptyString,
    date: ISODate,
    money: Money,
    recurring: Cadence,
    "group?": NonEmptyString,
    "comment?": string(),
    "usdAmount?": Money,
    "perMonth?": Money,
    dateEnd: ISODate,
    "canceledAt?": ISODate,
  })

const ExportSummary = () =>
  object({
    total: Money,
    perMonth: Money,
  })

const WorkbookExportRequest = () =>
  object({
    userId: NonEmptyString,
    baseCurrency: CurrencyCode,
    "format?": WorkbookFormat,
    "summary?": ExportSummary,
    rows: array(ExportRow, { minItems: 0 }),
  })

const api = responsibleAPI({
  partialDoc: {
    openapi: "3.1.0",
    info: {
      title: "Recurring Workbook Export Service API",
      version: "1",
    },
  },
  routes: {
    "/healthz": GET({
      id: "healthCheck",
      description:
        "Operational health check for reverse proxies and load balancers.",
      res: {
        200: resp({
          description: "Service is healthy.",
        }),
      },
    }),
    "/exports/workbook": POST("createWorkbookExport", {
      req: {
        mime: "application/json",
        body: WorkbookExportRequest,
      },
      res: {
        201: WorkbookExportResponse,
      },
    }),
  },
})

console.log(YAML.stringify(api, null, 2))
