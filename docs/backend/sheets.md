# User Data Export Plan

## Goal

Recurring needs durable user data export before the service reaches end of life.

Primary export target: Google Sheets.

The export should remain useful after the app is gone:

- raw user data visible in normal spreadsheet tabs
- formulas preserved
- users can keep adding and editing expenses
- currency conversion keeps working without Recurring
- no API keys or service secrets embedded in the spreadsheet
- no Apps Script dependency

Recurring is DIY accounting software for individuals and single-member LLCs. Exports should be practical and maintainable, not accounting-grade audit artifacts.

## Product Strategy

Use native Google Sheets formulas as the currency conversion source.

Do not make the spreadsheet depend on:

- Recurring runtime
- Recurring-hosted FX APIs
- export-service rate caches
- provider API keys
- Apps Script
- manual maintenance of a hidden rates table

This trades strict reproducibility for long-term maintainability. Currency-derived totals may change when Google refreshes exchange data. That is acceptable for this product tier.

## Platform Support

### Google Sheets

Google Sheets is the primary supported living export format.

Reasons:

- free-tier users can open and maintain the sheet
- `GOOGLEFINANCE` gives formula-level currency rates
- formulas survive after Recurring shuts down
- users can add new rows without maintaining a separate rates cache
- sharing and collaboration are native to the target workflow

### Excel

Excel is not a primary living export target for currency conversion.

Excel has currency-linked data types and financial data functions, but they are not a reliable free-tier, formula-only equivalent to Google Sheets `GOOGLEFINANCE`:

- behavior depends on Microsoft account, Microsoft 365, client, region, and refresh support
- linked data types are not simple portable formulas
- older Excel versions degrade or lose linked-data behavior
- `STOCKHISTORY` requires Microsoft 365

If Excel export is added later, treat it as a static `.xlsx` fallback with manual FX override columns. Do not promise live currency updates for Excel free-tier users.

## Service Shape

Add a JavaScript export microservice:

- runtime: Bun
- HTTP framework: Hono
- package location: `apps/export`
- responsibility: build spreadsheet exports

Initial endpoint:

```http
POST /exports/google-sheet
```

Response:

```json
{
  "spreadsheetId": "google-spreadsheet-id",
  "url": "https://docs.google.com/spreadsheets/d/..."
}
```

## Export Model

Backend API should provide normalized export data to the export service. Export service should not query app database directly unless later needed for performance.

Suggested input:

```json
{
  "userId": "user-id",
  "baseCurrency": "USD",
  "expenses": [
    {
      "id": "expense-id",
      "name": "Figma",
      "amount": 15,
      "currency": "USD",
      "cadence": "monthly",
      "nextDueDate": "2026-05-01",
      "category": "Software",
      "createdAt": "2026-04-01T00:00:00Z",
      "updatedAt": "2026-04-20T00:00:00Z"
    }
  ]
}
```

## Spreadsheet Layout

Create these tabs:

- `Expenses`: editable recurring expense rows
- `Summary`: totals by month, category, and currency
- `Settings`: base currency and summary settings
- `Metadata`: export timestamp, app version, source user id, export notes

Do not require a hidden `Rates` tab for normal operation.

`Expenses` columns:

- Expense ID
- Name
- Category
- Amount
- Currency
- Base Currency
- FX Rate
- Manual FX Rate
- Effective FX Rate
- Base Amount
- Cadence
- Next Due Date
- Annualized Base Amount
- Created At
- Updated At
- Notes

Formula examples:

```text
FX Rate:
=IF(E2=F2,1,GOOGLEFINANCE("CURRENCY:"&E2&F2))

Effective FX Rate:
=IF(ISBLANK(H2),G2,H2)

Base Amount:
=D2*I2

Annualized Base Amount:
=J2*SWITCH(K2,"weekly",52,"monthly",12,"quarterly",4,"yearly",1,0)
```

`Base Currency` should default from `Settings`, for example:

```text
=Settings!$B$1
```

Use generated formulas for exported rows. Leave formulas copyable so users can add rows after Recurring shuts down.

## Currency Conversion

Use current native Google Sheets FX formulas by default.

Default behavior:

- `GOOGLEFINANCE("CURRENCY:"&source_currency&base_currency)` calculates FX rate
- formulas update when Google Sheets recalculates
- users can add new currencies by typing ISO currency codes
- no provider keys are stored anywhere
- no export-service rate cache is needed for MVP

Do not use historical FX by default. Individuals and single-member LLCs usually need a maintainable recurring-cost workbook, not strict transaction-date accounting.

If historical FX is later required, make it explicit and optional. Add a `Rate Date` column after `Base Currency` for that mode:

```text
=IF(E2=F2,1,INDEX(GOOGLEFINANCE("CURRENCY:"&E2&F2,"price",G2),2,2))
```

That mode should document possible `#N/A` behavior for dates, weekends, holidays, unsupported pairs, and Google data limitations.

## Manual Overrides

The sheet should support a manual override path without scripts.

Recommended columns:

- FX Rate
- Manual FX Rate
- Effective FX Rate

Formula:

```text
=IF(ISBLANK(H2),G2,H2)
```

This lets users replace a bad or missing native rate without editing generated formulas.

## Google Sheets Integration

Use Google Sheets API from export service.

Flow:

1. API receives user export request.
2. API authorizes request.
3. API sends normalized export payload to export service.
4. Export service creates Google Sheet.
5. Export service writes values, formulas, formatting, frozen header rows, filters, and data validation.
6. Export service protects formula columns where useful but keeps the workbook editable.
7. Export service returns sheet URL.

Auth options:

- service account creates sheets owned by product workspace
- user OAuth creates sheets in user Google Drive

Initial recommendation: user OAuth if users expect the sheet to live in their own Drive after shutdown. Service account only works if ownership and post-shutdown access policy are clear.

## API Contract

Add OpenAPI endpoints later:

```http
POST /exports
GET /exports/{exportId}
```

`POST /exports` request:

```json
{
  "format": "google_sheet",
  "baseCurrency": "USD"
}
```

`GET /exports/{exportId}` response:

```json
{
  "id": "export-id",
  "status": "pending|running|complete|failed",
  "format": "google_sheet",
  "url": "https://docs.google.com/spreadsheets/d/...",
  "createdAt": "2026-04-26T00:00:00Z",
  "completedAt": "2026-04-26T00:00:10Z",
  "error": null
}
```

## Reliability

Exports should be async once dataset size or Google API latency matters.

Minimum production behavior:

- idempotency key for export creation
- Google API timeout
- retry with bounded backoff
- export status persisted
- failed export includes user-safe error message
- internal logs include Google API error details
- generated sheet URL stored with export record

## Security

Do not include secrets in spreadsheet formulas or metadata.

Spreadsheet sharing policy must be explicit:

- private to requesting user, or
- link-shared read-only, or
- app-managed access list

Default: private to requesting user when using user OAuth.

## Testing

Unit tests:

- cadence annualization
- formula generation
- Settings tab references
- manual FX override formula
- unsupported cadence handling

Integration tests:

- fake Google Sheets client
- export payload to workbook model
- generated workbook has no Apps Script
- generated workbook has no API keys

Manual smoke test:

- create export for user with multi-currency expenses
- open sheet with free Google account
- verify `GOOGLEFINANCE` formulas calculate
- add a new expense row manually
- copy formulas into the new row
- verify summaries update
- verify no secrets in any cell

## Later Options

- static `.xlsx` fallback through ExcelJS
- optional snapshot values for users who want frozen totals
- optional historical FX mode with clear limitations
