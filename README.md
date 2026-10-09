# Fin Buddy

An offline-first finance app that imports local financial statements, organizes transactions, learns categorization rules, and generates monthly cash-flow reports after review is complete.

## Install Fin Buddy 1.1.0

[Download the signed Android installer](https://github.com/Developerguy3/Fin-buddy/releases/download/v1.1.0/Fin-Buddy-1.1.0-android.apk) (about 162 MiB). The repository and downloads are private, so sign in to the owning GitHub account.

[Release downloads](https://github.com/Developerguy3/Fin-buddy/releases/tag/v1.1.0) also include the standalone local web bundle, iOS simulator app and Android checksum. The Android and iOS simulator builds passed GitHub validation, and 31 automated tests passed. Physical-device testing has not been performed. Real-iPhone distribution signing is deferred until an Apple Developer account is configured.

## Getting started

Requirements: Node.js 20 or later. Document imports also require Python and the packages in `requirements.txt`. Image OCR uses Windows OCR; text-based exports work without it.

```powershell
python -m pip install -r requirements.txt
$env:FIN_BUDDY_PYTHON = "C:\path\to\python.exe"
npm start
```

Open [localhost:3210](http://localhost:3210). The server listens on loopback only. No npm packages are required. On a machine with the bundled Codex Python runtime, the app finds that runtime automatically. Otherwise set `FIN_BUDDY_PYTHON` to your Python executable. To change the port, set `PORT` before starting.

Choose Personal or Professional on first use, then follow the guided tutorial. Replay it from the profile icon → **User manual**.

## Web, Android and iOS

The web UI adapts to phones and tablets with touch-sized controls, safe-area spacing, bottom navigation, stacked transaction cards and responsive dialogs. The profile menu includes web installation instructions. The web service worker caches only an offline information screen and static assets; financial API responses are never cached. The desktop web app still needs its local server.

Native Android and iOS source projects bundle an independent on-device ledger and small local LLM. See [mobile build instructions](mobile/README.md) for build commands, model size, signing requirements and mobile-specific limitations. Native PDF, spreadsheet, Word/XML and image readers run locally, with balance validation and bundled English OCR. Ambiguous document extraction remains unfinished until reviewed. Multiple device folders, encrypted backups and PDF report export are available.

## Multiple profiles

Open the profile icon → **Profiles · switch / add** to create a named Personal or Professional profile or switch between profiles. Your existing ledger stays in **Main profile**. Each profile has its own folders, transactions, categories, rules, reports and AI settings. New profiles start empty; add sources after creating one. The active profile is remembered after restarting. Save or close open transaction editors before switching. Profiles are local workspaces, not separate authenticated accounts.

## Import, review, report

1. Open the profile icon → **Statement folders**. Browse using the folder icon or enter an absolute folder path. Add multiple locations with **+ Add source**, then **Save & import all sources**. All ordinary subfolders are scanned. Removing a source preserves previously imported transactions.
2. Use **Refresh** on Overview to rescan saved sources for new statements. Original statement files are never overwritten.
3. Open **Notifications** for unreadable statements and unfinished categories. **Transactions** shows the monthly ledger, expandable bank/account filters, and compact account details. Filters support account, merchant text, category, money direction, and unfinished status. Bank account panels expand below a fixed button row with Expand all / Collapse all. Withdrawals are red; deposits are green.
4. Assign categories individually or apply them to selected merchant-group transactions. Create categories during review, or open **Categories & rules** for processing summaries, bulk merchant review, and to rename categories and edit multiple merchant phrases, one per line.
5. Select a month and open **Monthly report**. Reports stay locked until all import issues and that month’s unknown transactions are resolved. Generate the report, then print or save a PDF using your browser.

Overview shows income, expenses, net cash flow, and spending suggestions after review is complete. Transfers are excluded from cash flow; refunds count as inflows. This is a cash-flow summary, not a tax or accounting statement. A completed month can be reported while another month still has unfinished categories. Mixed currencies cannot be combined into a single monthly report.

## Merchant rules and groups

Rules accept comma-separated keywords, phrases, abbreviations and numeric references, using Any (OR) or All (AND) matching. The optional rule note explains its purpose and does not affect matching. Optional account, amount, date, location and payment-channel scope narrow matching. More specific rules take precedence; equally specific conflicting categories stay unfinished. Edits update matching transactions across imported months and future imports. Saving a remembered rule applies it to all matching existing transactions, including categorized ones, and future imports. Other open editors and unsaved choices remain intact. Close discards only its editor.

Recognition runs after imports and corrections: saved rules, signed money direction, prior confirmed merchant corrections, recognized payment phrases, then a local model when available. Incoming payments become Income; matching own-account transfers are excluded. An outgoing e-transfer with a person's name remains an expense requiring a known purpose. A correction teaches consistent repeated merchants within the same account and direction.

Repeated merchants are normalized conservatively and kept separate by account, currency, and money direction. Original descriptions remain available. Confirm aliases when different names represent the same merchant. Split selected transactions into named groups or preview selections using rule scope, then merge groups back when needed. Preview counts describe current transactions, not a prediction of future transaction counts.

## Trips and optional local AI

Trips appear on Overview only when a suggestion or confirmed trip exists. Trip suggestions require explicit location metadata and multiple spending signals close in time. A merchant location does not prove physical presence. Missing payment channels remain **Unknown**; online/recurring purchases do not contribute to trip detection. Confirm, rename, adjust dates, label business/personal purpose, change membership, or delete a trip without deleting its transactions. Suggestions can be disabled and derived trip data cleared. Savings suggestions are collapsible. No device location history is collected.

Automatic local AI supports Ollama and OpenAI-compatible loopback servers. Configure **Categories & rules → Automatic recognition → Local model connection**, or leave the model blank to discover installed models. Only merchant names and sampled descriptions go to that local service. High-confidence classifications with an explanation are applied automatically; uncertain suggestions and rule conflicts stay for review. Availability and classification evidence are shown explicitly. A running installed model is required; the app does not download one or send data to a cloud provider.

The fallback reader examines readable text, PDF content, office containers and images. Financial documents without bank transactions, such as invoices, are indexed separately with document type, currency and explicit totals. They never create inferred payments. Unknown binary formats, encrypted documents and statement layouts that cannot be extracted reliably still require attention.

## Supported statements

Containers: PDF, CSV, TSV, delimited TXT, XLS/XLSX/XLSM, ODS, OFX/QFX, QIF, JSON, XML, HTML/HTM, DOCX tables, and PNG/JPG/JPEG/TIFF/BMP/WebP images. A supported extension does not guarantee that every bank layout can be interpreted.

Recognized PDFs include RBC business chequing, Visa, operating loans, online banking, and UCU exports. Applicable counts, totals, running balances, or closing balances are validated. Recognized summaries contain no invented transactions. Windows OCR handles images and scanned PDFs; unfamiliar or unvalidated layouts appear in Notifications.

CSV and table exports need `Date,Description,Amount` or `Date,Description,Debit,Credit`, with common column aliases accepted. Dates use `YYYY-MM-DD` or US `MM/DD/YYYY`. Positive amounts are inflows; negative amounts are outflows. Debit and Credit values are positive. Optional Currency, City, Location, and Channel columns preserve explicit metadata. Export currencies default to USD when absent; recognized Canadian bank PDFs use CAD. All recognizable XLSX/XLSM worksheets are imported. Legacy XLS and other table containers currently use their first recognizable table.

```csv
Date,Description,Amount,Currency
2026-09-01,Salary,3500.00,CAD
2026-09-02,Neighborhood grocery,-64.25,CAD
```

Notifications allow a file to be marked as a non-statement or supplied with a complete corrected transaction CSV. Corrections are stored separately, linked to the original file hash. Malformed row errors identify the row when available. Linked folders/files are reported as issues; add the actual target folder as a source instead.

## Local storage and security

- `data/ledger.json`: transactions, categories, rules, sources, corrections, and groups. Back up this file.
- `data/import-cache.json`: local document extraction cache for faster rescans.
- `statements/`: optional default statement source.

Identical files and repeated account/date/amount/normalized-description occurrences are deduplicated. Duplicate shadow records are held out of reports when retained. Different descriptions or dates can prevent detection, so review overlapping exports carefully. Removing source files does not delete ledger transactions.

There is no app password lock, built-in encryption, cloud login, or cloud sync. Windows account and disk protections control local file access. The profile menu provides Settings, Login information, Security, About us, User manual, and FAQ.

Financial data, statement files, document caches, installed dependencies, and Python bytecode are excluded from Git. Only application code, documentation, and synthetic tests belong in this repository.

## Tests

```powershell
npm test
```

Tests cover transaction splitting, parsing, cents-based totals, review gates, imports, duplicate handling, persistence, category renaming, bulk review, split/merge, trip evidence, local AI validation, and Overview calculations.

## Transaction splits and activity status

Use **Edit → Split transaction** to assign an original transaction to 2–20 named parts. Part amounts must add up exactly to the original signed amount. Each part has its own category; unknown parts still block the monthly report. Details retain the original description, amount, account, and source. The original statement is untouched. Use **Undo split** from a part’s split editor to restore the original transaction. Split/undo preserves memberships in merchant and trip groups.

The sidebar activity indicator stays green for local operations and local-model requests. It shows Communicating with local LLM during prediction requests, then returns to Local workspace. An external request through the app’s request helper shows a yellow Going online indicator until the request finishes. This version does not perform web searches or send finance data to a cloud model.

Changing months resets transaction filters. When an imported month still has unfinished categories, Overview explains why totals are locked and links directly to review.
