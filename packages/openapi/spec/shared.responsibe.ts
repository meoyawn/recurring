import { int64, object, resp, string } from "@responsibleapi/ts"

export const NonEmptyString = () => string({ minLength: 1 })

export const CurrencyCode = () =>
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

export const Money = () =>
  object({
    amount: MinorUnitAmount,
    currency: CurrencyCode,
  })

export const WorkbookFormat = () =>
  string({
    default: "xlsx",
    description:
      "Workbook file format. Use xlsx unless legacy xls is required.",
    enum: ["xlsx", "xls"],
    examples: ["xlsx"],
  })

export const WorkbookExportResponse = () =>
  resp({
    description:
      "Generated workbook file. Consumers that proxy this response should preserve Content-Type, Content-Disposition, Cache-Control, and X-Recurring-Export-Warning.",
    headers: {
      "Content-Disposition": {
        description: "Browser download filename.",
        schema: string({
          examples: ['attachment; filename="recurring-export.xlsx"'],
        }),
      },
      "Cache-Control": {
        description:
          "User export files should not be cached by intermediaries.",
        schema: string({
          const: "no-store",
        }),
      },
      "X-Recurring-Export-Warning": {
        description:
          "User-facing warning for web UI before or during download.",
        schema: string({
          examples: [
            "Currency conversion formulas use GOOGLEFINANCE and may not work in Excel. Open in Google Sheets or use manual FX rates.",
          ],
        }),
      },
    },
    body: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        string({ format: "binary" }),
      "application/vnd.ms-excel": string({ format: "binary" }),
    },
  })
