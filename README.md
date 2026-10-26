# Invoice Studio 3.0.1

An offline Windows invoice workstation for Magic Roots. The familiar three-column editor, live preview, document tabs, favourites, themes and WhatsApp snippets now use a SQLite database in a separate writable data folder. The supplied samples were backed up and are **not imported into a fresh installation**. Stock tracking starts disabled.

## Open the app

Download the installer or portable app from [GitHub Releases](https://github.com/aimummatv/Invoice-Studio/releases/latest). Windows builds are release downloads; the repository contains the editable source. Local backups, business records and generated test files are excluded from Git.

- **Install:** run `release/Invoice-Studio-3.0.1-Setup-x64.exe`. Choose a per-user installation directory. The installer creates desktop and Start menu shortcuts.
- **Run without installing:** double-click `release/Invoice-Studio-3.0.1-Portable.exe`.
- `start.bat` opens an available built executable, or the development Electron runtime.

Windows 10/11 x64 is the target. Neither Node, Python nor Microsoft Excel is required by the packaged app. Ordinary billing, search, backups, PDF and workbook operations use bundled assets and work offline. Both executables are unsigned; no signing certificate was supplied.

Start in **Business & settings** (top-right gear). Enter your actual legal details, address, GSTIN/registration scheme, bank details and reviewed defaults. No tax rate is assumed on a new taxable line. Create customers/products, enter or select a buyer, add lines, then check **Invoice health** before issuing.

## Save, issue and correct

Draft edits auto-save after a short pause. **Ctrl+S** explicitly saves; the ribbon reports Saving, Saved to disk or Save failed. An unsaved failure keeps the app open when you try to close it. **Ctrl+P** opens printing. Undo reverses draft edits; issued documents are immutable snapshots.

Issue allocates a separate number series for each document type and April–March financial year, for example `MR/TI/26-27/0001`. Numbers are unique, at most 16 characters, and retained after cancellation. A series supports 9,999 documents per type/year; a new series configuration is needed beyond that capacity. A supplier prefix is 1–2 uppercase letters/digits. Drafts have no final number.

Tax Invoice and Bill of Supply are sales. Proforma is an estimate. Delivery Challan records movement, not turnover. Advance Receipt creates a single actual payment. Credit Note links to an issued invoice and caps cumulative quantities/tax/value at the original amounts. Enter only quantities being credited; rates and final paise use the original snapshot. A final fractional credit consumes the remaining original paise, including original round-off.

Use the register to open, duplicate, convert, credit or cancel documents. A duplicate resets number, date, IRN/e-way references and payment allocations. Converted challans preserve dispatched quantities and cannot deduct stock twice. Cancel linked credits/allocations before cancelling their original document.

Manual buyers are assigned a stable customer record at issue. Later invoices should select that saved customer. Identical names alone do not merge accounts. Billing/shipping addresses remain separate and are frozen into each issued document.

## Payments and balances

Record payments with customer, amount, date, method and reference. Allocate all or part of a payment across invoices for that customer. Unallocated advances stay available. In Bank & terms, an invoice can apply an already recorded advance once at issue. The PDF shows the recorded advance and balance **at issue**. The register/reports show current balances from the ledger.

Payment status cannot manufacture cash receipts. Reallocate or void erroneous payments with an audit reason. Credits can leave a negative customer balance when an invoice was already paid; this represents customer credit. A dedicated outgoing refund/disbursement ledger is not part of this release—record the refund in your accounting system. This application is a billing workstation, not a general ledger.

## Calculations and tax review

Unit prices and quantities support six decimal places. Decimal arithmetic rounds taxable values and each tax component half-up to paise. Fees allocate proportionally with deterministic paise remainders. Mixed line rates, inclusive/exclusive prices, line/document discounts, freight, packing, percentage cess, reverse charge, explicit round-off and distinct nil/exempt/non-GST categories are supported. Round-off cannot make a total negative. Values are bounded to safe integer paise storage.

Supplier state and Place of Supply choose CGST plus SGST/UTGST or IGST. GSTIN state is only an input suggestion. Bill of Supply suppresses tax and checks the supplier scheme/line category. Export/SEZ treatment and LUT references are available, with review warnings; supply/payment date transitions require review. HSN/SAC is retained as full text, including leading zeros; no truncation is performed.

Output-tax totals exclude tax payable by the recipient under reverse charge. HSN breakdowns retain calculated tax and a separate reverse-charge flag. Monthly exports list recipient tax separately.

Product suggestions are deterministic hints. Ambiguous matches present alternatives and never confirm a rate. You can change a line for this document or remember it in the catalogue. Tax rules carry effective dates, source URL, reviewer and verification date. Workbook imports always leave changed classifications/rules unverified. No official tax table is seeded as confirmed.

Offline GSTIN checks cover syntax/checksum, not registration status or legal-name lookup. **Online GSTIN lookup, IRN generation and e-way generation are not configured.** Existing references can be entered; the app does not claim to generate them. The e-way value threshold is a configurable review trigger, not an applicability determination. GSTR-style CSV is a reconciliation export, not a tested GST portal import file.

Official references checked during implementation: [CBIC Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001), [GST Portal GSTR-1 guidance](https://tutorial.gst.gov.in/userguide/returns/GSTR_1.htm), and [official HSN digit guidance](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1708713&lang=2&reg=48). Your turnover, supply, product specification and current notifications determine applicability. The software permits 4–8 digit codes and requires business review of reporting digit requirements.

## Printing, PDF and sharing

PDF uses Chromium's text/vector printing engine and bundled fonts. A4 pages paginate without forced shrinking. Tables repeat headings, rows stay together where possible, very long descriptions continue, totals/signature appear at the end, and PDFs include page numbers. Appearance offers Simple/Detailed/Transport/custom presets, density, optional sections and one or all three labelled copies. Required HSN, signature and differing delivery-address checks prevent hiding essential fields at issue.

The preview scrolls at a readable width in small windows. It is a live content preview; the PDF/print engine determines actual page breaks. A visual signature area is not a cryptographic signature.

WhatsApp is an explicit user action: export PDF/open its folder, open the recipient chat, and **attach the file manually**. A WhatsApp URL cannot attach a local file. Sending requires internet. No messaging or uploading runs automatically.

## Excel

`templates/InvoiceStudio-Template.xlsx` contains fictitious examples; remove them before entering real records. You can also generate a template or current export in **Excel & recovery**. The app uses SQLite as its source of truth—there is no silent two-way Excel sync.

Editable imports: Products, Customers, Buyer Prices, allowlisted non-secret Settings, and reviewed Tax Rules. Invoices, Invoice Items, Payments, Credits, HSN Summary and Monthly Sales are report sheets. IDs match records; revisions detect stale edits. Keep identifiers/HSN/state codes as Text. Reimporting unchanged content does not duplicate it.

Preview lists additions, updates, unchanged rows, conflicts and row errors. Only accepted valid rows commit together after a verified backup. Imported tax rules require explicit review. Formulas/macros/external workbook links are rejected; files are limited to 10 MB, 50 MB expanded and 10,000 rows per editable sheet. Supported workbook version is 1. Plain values, Unicode, leading zeros and typed decimals are preserved.

Save As preserves locked files. A previously exported file that changed externally is not silently overwritten; review it and select another filename. Optional automatic refresh writes only `Exports/InvoiceStudio-managed.xlsx`; manual imports remain separate. Export failure does not undo a saved invoice. CSV text is escaped against spreadsheet formula injection; use XLSX to preserve identifier formatting.

## Data, backups and recovery

The default database is `%APPDATA%/invoice-billing-studio/Data/InvoiceStudio.db`. **Excel & recovery** shows the exact active folder and offers Move data folder, Backup, Restore, integrity checks and audit history. A missing configured folder stops startup; the app never silently falls back to an empty database. A recovery dialog can select an existing folder.

SQLite manages its WAL/SHM sidecars. Do not copy only an active `.db` file. Built-in backups use SQLite's supported online backup API and verify integrity. Automatic backups run before the first/hourly changed operation and at clean close; manual backups and backups before bulk import/restore are available. Retention is configurable. Set a secondary folder on another drive for protection against disk failure. Secondary-folder errors are visible.

Restore validates schema, integrity, references and snapshot hashes in a staging database, backs up the current database, then uses SQLite's transactional backup API to restore. An uninstall/upgrade does not delete business data. Keep independent backups before installing updates.

**Explicit portable data mode:** beside the portable `.exe`, save a file named `InvoiceStudio.portable.json` containing `{"portable":true,"initialized":false}`. An example is in `scripts/portable-mode.example.json`. The first launch creates `Invoice Studio Data` beside the executable and marks it initialized. Subsequent missing data stops startup. Without the marker, even the portable executable uses the per-user data folder. Choose a writable folder; Program Files is unsuitable for portable data.

For isolated diagnostics, `--data-folder=ABSOLUTE_PATH` opens an existing database without redirecting normal configuration. Add `--new-data-folder` only when deliberately creating one.

## Legacy samples and recovery

The original local workspace retains source/data in `Backups/source-before-desktop-20261026-160141/`, with `SHA256-MANIFEST.json`, and the former data folder in `Backups/legacy-data-before-cleanup-20261026/`. These backups are excluded from GitHub and the release. The supplied records were confirmed to be samples; no browser-storage migration runs automatically.

Recover legacy JSON or `const INITIAL_DATA = …` files through a preview. The importer parses JSON only and never executes the JavaScript. It protects conflicting IDs, preserves original amounts/rates/raw records and marks historical snapshots for review. Legacy payments and attachment references are retained as raw migration evidence; they do not silently create new cash allocations. Historical ledger/line-tax reconciliation is required before credits against those records. Nothing is repriced to a default rate.

If recovering a different old browser origin, open the backed-up original app in that same browser/origin and export `localStorage.getItem('INVOICE_STUDIO_DATA_V1')` as JSON through browser developer tools. Filesystem access cannot establish that all browser records were captured. Do not replace an existing database with an unreviewed whole dataset.

## Optional stock and cost checks

Stock starts off. When enabled globally and per product, opening stock plus dispatch/sales, selected physical credit returns, cancellations and audited adjustments determine balance. Proforma and advance receipts do not move stock. Batch/manufacture/expiry/licence fields are optional; product names do not infer regulatory classification. Below-cost warnings compare entered sale prices with the recorded before-tax cost and explicitly require checking inclusive-price assumptions. Inventory valuation and a full realised P&L/general ledger are outside this release.

## Development and verification

Node 24 is the development baseline. Pinned versions and transitive integrity hashes are in `package-lock.json`.

```powershell
npm ci
node node_modules/electron/install.js
npm run build:css
npm test
npm run test:desktop
npm run dist
node scripts/packaged-smoke.cjs
```

The distribution build reuses `node_modules/electron/dist`, bundles runtime dependencies, and never publishes. `server.js` is an optional localhost read-only browser preview with no write API. See `TEST_REPORT.md` for exact results, evidence and environments not tested. Third-party licenses are included in `LICENSES/` and the runtime.
