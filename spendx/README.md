# Finance Habit Analyzer

A 100% offline, client-side web app that analyzes an exported OPay (or similar)
bank statement and generates spending insights, behavioral patterns, a
financial health score, and next-month predictions — entirely in the browser.
No backend, no server, no API calls, no data ever leaves your device.

## Running it

Just open `index.html` in any modern browser. That's it — no build step,
no `npm install`, no local server required. All required libraries
(Chart.js, PapaParse, SheetJS/xlsx) are vendored locally in `/vendor`, so
the app works with zero internet connection.

Click **"Load sample data"** on first open to see the app populated with a
realistic 3-month sample OPay statement, or click **"Import statement"** to
upload your own `.csv` or `.xlsx` export.

## File structure

```
index.html              Page shell, all view markup
style.css                Dark/light theme, fintech dashboard styling
app.js                   Orchestrator: wires import -> pipeline -> render

modules/
  sampleData.js          Built-in sample OPay statement (CSV string)
  parser.js              Reads CSV/XLSX, smart header detection, normalizes rows
  categorizer.js          Keyword-based category classification engine
  analytics.js            KPIs, breakdowns, insights, health score, recipients,
                          miscellaneous analysis, hidden costs, coach advice
  predictionEngine.js     Moving-average + trend-based forecasting
  charts.js               Chart.js wrappers for every visualization
  standaloneTools.js      Shopping List, Savings Goals, Debt Manager, Daily Tracker
  ui.js                   DOM rendering, navigation, dark mode, table filtering

vendor/
  papaparse.min.js        CSV parsing (PapaParse 5.x)
  xlsx.full.min.js        Excel parsing (SheetJS)
  chart.umd.min.js        Charting (Chart.js 4.x)
```

## How categorization works

`modules/categorizer.js` matches transaction descriptions against keyword
lists per category (see `CATEGORY_RULES`). To add a new merchant or
category, you only need to touch that one object — for example:

```js
// Add a keyword to an existing category:
CATEGORY_RULES.Food.push("dominos express");

// Or do it at runtime from anywhere in the app:
FHA.categorizer.addKeyword("Health", "pharmacy");
```

Anything that doesn't match any keyword falls back to `Miscellaneous`
rather than being dropped or causing an error.

## How predictions work

`modules/predictionEngine.js` is pure JavaScript — no cloud APIs, no ML
libraries. It combines:

- A **weighted moving average** over monthly totals (recent months count
  more than older ones)
- A **linear regression trend slope** layered on top, to capture direction
- A **z-score against historical net-cashflow volatility** to estimate the
  probability that next month's expenses will exceed income

## Data storage

Imported transactions are cached in `localStorage` (key `fha_transactions_v1`)
so your statement survives a page refresh. Use the **"Clear stored data"**
button in the sidebar to wipe it. Nothing is ever transmitted anywhere —
everything stays in your browser's local storage.

## Supported statement formats

The parser fuzzy-matches common OPay column header variants:

- Date columns: `Date`, `Transaction Date`, `Value Date`, etc.
- Description columns: `Description`, `Narration`, `Remarks`, `Particulars`
- Either a single `Amount` + `Type` (Credit/Debit) column pair, **or**
  separate `Credit`/`Debit` (a.k.a. `Money In`/`Money Out`) columns
- Optional `Balance` column

Dates support ISO (`YYYY-MM-DD`), `DD/MM/YYYY`, and native Excel date
cells/serials.

## Upgrades

### 1. Smart transaction table detection

Real-world statement exports often prepend account metadata above the
real transaction table (account name, account number, total credits,
opening/closing balance, etc.). The parser now reads files in headerless
mode first, scans every row for at least 2 transaction-related column
keywords (`Date`, `Description`, `Narration`, `Debit`, `Credit`, `Amount`,
`Balance`, `Reference`, ...), and treats the first matching row as the
real header — everything above it is discarded. Debug info from the most
recent parse (header row index, rows skipped, detected columns,
transactions imported) is available via `FHA.parser.getLastParseDebug()`
and shown in a panel under the import button.

### 2. Return-usage modules

Four standalone tools, independent of statement import, all persisted in
`localStorage` so they survive a reload — `modules/standaloneTools.js`:

- **Shopping List** — item, estimated price, notes, status (pending/completed)
- **Savings Goals** — target/saved amount, progress %, remaining amount, a
  rough estimated-completion date based on your own saving pace so far
- **Debt Manager** — money you owe vs money owed to you, with due dates and
  a net-position summary
- **Daily Spending Tracker** — manual day-to-day log with today/week/month rollups
- **Financial Coach** (`analytics.generateCoachAdvice`) — reuses the
  existing category/trend analytics to produce quantified advice like
  "Reducing Transport spending by 10% could save ₦X annually."

### 3. Smart miscellaneous analysis

`analytics.analyzeMiscellaneous()` never reclassifies a transaction — it
only adds a secondary, descriptive layer on top of whatever already fell
into `Miscellaneous`: total/percent of spending, what share are small
(<₦5,000) transactions, and pattern-based "likely source" guesses (food,
transport, personal transfers, etc.) based on words in the description.

### 4. Recipient intelligence

`analytics.analyzeRecipients()` extracts a counterparty name from
transfer-style descriptions ("TRANSFER TO X", "NIP TO X", etc. — merchant
purchases like "KFC IKEJA" are correctly left alone) and ranks recipients
by total amount and by frequency, with insights on concentration, the
most frequent/largest recipient, average transfer size, and unique
recipient count. Visualized with horizontal bar charts via
`charts.renderRecipientChart()`.

### 5. Transfer charge & hidden cost analysis

`analytics.analyzeHiddenCosts()` covers two angles, both purely
statistical (it never assumes an exact "real" item price):

- **Round-up detection** — flags low-value transfers whose amount ends in
  a remainder like +₦20/+₦50/+₦100 over a round figure, a common sign that
  a transfer fee was folded into the amount sent, and estimates the
  hidden-charge vs. real-spending split.
- **Confirmed bank charges** — a new `Bank Charges` category
  (`categorizer.js`) catches explicit fee line items (transfer charge,
  EMTL, VAT, stamp duty, SMS alert charge, maintenance fee, etc.) and
  reports total/monthly charges and their share of overall spending.

Both feed into a combined hidden-cost report shown in the **Hidden Costs**
view.
