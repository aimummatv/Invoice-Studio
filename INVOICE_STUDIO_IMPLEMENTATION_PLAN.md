# Invoice Studio — Implementation Plan
Prepared: 26 October 2026
Target project: C:\Users\Admin\Desktop\New invoice-studio
Status: Version 3.0.1 implemented and packaged. Local source, database, PDF, workbook and packaged/portable checks passed; see TEST_REPORT.md for exact evidence and remaining environment/service limits.

## 1. Goal and handoff instructions

Turn the existing invoice application into a dependable Windows desktop application that opens from a desktop shortcut or an .exe, works without internet, preserves existing business records, and supports Excel imports/exports.

For the implementing Codex session:
- Read this file and applicable AGENTS.md instructions; inspect the current project before changing it.
- Implement the phases below in dependency order. Preserve the existing branding and useful workflows.
- The user authorizes the implementation and routine reversible decisions. Ask only about genuinely blocking business choices or ambiguous migration conflicts.
- Back up source and data before migration. Work on copies while testing.
- Do not publish the project, upload real customer records, or change repository visibility without the applicable authorization and access.
- Mark completed checklist items and maintain an implementation/test report. Report unfinished work explicitly.
- Do not claim “zero bugs.” Finish with the actual checks run, their results, and remaining limitations.
- This plan supersedes the earlier proposal to make IndexedDB the main database. SQLite is the desktop application's authoritative data store.

## 2. Existing state: observed versus unverified

Observed during limited inspection:
- index.html, css/, js/studio.js, data/mock-data.js, lib/, server.js and start.bat exist.
- The frontend uses localStorage and POST /api/data.
- The server persists business data into data/mock-data.js, with a temporary file and one backup.
- The current launcher requires Node.js, otherwise falls back to opening index.html.
- The server moves to a different port when the preferred port is occupied.
- PDF export invokes html2pdf. The README describes a single-page A4 layout and a Tailwind CDN dependency.
- .gitignore does not currently exclude the live data file.
- Existing document types described by the README include invoice, proforma, advance receipt, delivery challan and credit note.

Still to audit:
- Exact data schema, all rendering/calculation paths, existing tests, assets, fonts and dependencies.
- Whether browser storage contains newer data than the disk file.
- Repository identity/visibility and whether any committed business information is real.
- Actual print defects and the current state of each feature. Do not blindly duplicate existing features.
- No complete security, financial or compliance audit has yet been performed.

## 3. Architecture decision

Use an Electron desktop shell as the default implementation approach, reusing the existing HTML/CSS/JavaScript interface. Verify supported dependency versions in official documentation at implementation time and pin them with a lockfile.

- Main process: SQLite access, file dialogs, backups, workbook import/export, PDF generation and app lifecycle.
- Preload: a small, explicitly named IPC API. Validate requests and responses.
- Renderer: interface only; no direct filesystem/database access, no Node integration, context isolation enabled, sandbox where supported.
- Use parameterized SQL, transactions, foreign keys, schema migrations and a single application instance.
- Bundle the runtime, styles, fonts, icons and libraries. End users should not need Node, Python, Excel, a terminal or internet to run ordinary billing.
- Use the desktop print/PDF API to generate selectable-text PDFs and attachable files; provide a print dialog as well.
- If retaining browser/server development mode, keep it optional and make its persistence behavior explicit. Do not promise shared browser-origin storage.
- A PWA/service worker is optional for a separately supported browser edition, not necessary for the offline desktop release. Do not maintain two competing primary databases.

Default data location: a writable per-user application data directory, separate from installed program files.
Offer a configurable data folder and an explicit portable mode for a writable folder alongside the .exe.
Never silently fall back to a new empty database when the configured folder becomes unavailable.

Proposed user-visible files:
- Invoice Studio.exe / installed shortcut
- InvoiceStudio.db
- InvoiceStudio.xlsx (export/import workbook)
- Backups/
- Exports/ (PDF and CSV)
Keep technical database sidecar files managed by SQLite; use its supported backup mechanism.

## 4. Data model and business invariants

Create versioned tables or equivalent normalized structures for:
- Business profiles, settings and appearance presets
- Products, units, case packs, categories and buyer-specific prices
- Parties and distinct billing/shipping addresses
- Tax classifications, effective-date rules, evidence references and verification history
- Documents, document lines, tax breakdowns, original-document links and immutable issued snapshots
- Number series by business, financial year and document type
- Payments, payment allocations, credit adjustments and audit events
- Import/export history, backup history and schema migrations
- Optional inventory movements and product batch records

Rules:
- Use stable IDs; human-readable invoice numbers are separately unique.
- Store currency with an explicit decimal-safe policy, supporting higher precision for unit prices/quantities and final paise rounding. Avoid floating-point accumulation.
- Drafts auto-save. Finalisation allocates a unique number and captures a transactionally consistent snapshot.
- Changes to catalogue prices, tax rules, party addresses, bank details or templates must not rewrite an issued invoice.
- Keep document lifecycle (draft/finalised/cancelled) separate from payment status (unpaid/partial/paid).
- Derive balances from payments, allocations and credits; do not let a status toggle fabricate a payment.
- Audit amendments/cancellations; retain cancelled numbers and references.
- Prevent stale-window overwrites and duplicate finalisation.
- Preserve full HSN/SAC values as text, including leading zeros; display/report length is a separate rule.

## 5. Excel workflow

SQLite remains the source of truth. Excel is an editable catalogue/party import interface and a readable reporting/export format. No silent two-way sync.

Workbook sheets:
| Sheet | Purpose | Import policy |
| --- | --- | --- |
| Read Me | Instructions, version, export timestamp, ID rules | Informational |
| Products | Names, categories, HSN, unit, case pack, prices, favourites, stock settings | Validate and preview updates |
| Customers | GSTIN, addresses, terms, contact information | Validate and preview updates |
| Buyer Prices | Product/customer price agreements | Validate linked IDs |
| Settings | Supported non-secret business/default settings | Allowlisted fields only |
| Tax Rules | Rates, dates, source references, verification fields | Require explicit review; never auto-confirm |
| Invoices | One row per issued document | Report only by default |
| Invoice Items | One row per line linked by document ID | Report only by default |
| Payments | Payment register and allocations | Report only initially; separate validated import if implemented |
| Credits | Credit-note register and original links | Report only |
| HSN Summary | Aggregated taxable value and tax | Report only |
| Monthly Sales | Period totals | Report only |

Implementation requirements:
- Generate a template with headers, examples using fictitious data, frozen rows and helpful dropdowns.
- Do not create a sheet for every invoice by default; use the register and printable PDFs.
- Import through a preview: additions, updates, conflicts, skipped rows and row-level errors.
- Use IDs, not row position or name alone, to match records. Reimporting the same file must not duplicate records.
- Handle dates, decimals, Unicode, leading-zero codes and blank values consistently.
- Never execute formulas/macros; reject formulas in imported data fields or require plain values.
- Escape spreadsheet formula injection in CSV; write external text as string cells in XLSX.
- Reject unsupported workbook versions and oversized/malformed input safely.
- Back up before bulk changes; commit accepted imports atomically.
- If the workbook is open/locked, preserve the existing file and offer retry or Save As.
- Show last export time and pending edits/conflicts. Never overwrite an externally changed workbook without review.
- Permit automatic refreshed exports only to an app-managed output file; keep manual editable imports separate when needed.
- A failed workbook export must not lose or roll back an already saved invoice.
- Excel itself must not be required on the user's PC.

## 6. Smart tax and catalogue engine

Implement tax calculations as pure functions separated from UI and persistence.

Catalogue:
- Product name/SKU, category, HSN/SAC, unit, case pack, default selling price, optional cost, tax classification, rate history and verification date/person.
- Deterministic keyword suggestions with confidence and “Suggested — verify” badges.
- Ambiguous classifications must present alternatives instead of silently guessing.
- “This document only” versus “Remember for this product” controls.
- Store source URL/notification identifier and effective dates for confirmed rules.

Calculations and validation:
- Mixed rates per line, tax-inclusive/exclusive pricing, discounts, freight/packing allocation, fractional quantities, optional cess and explicit round-off.
- Group tax summaries by classification, HSN and rate; show applicable CGST/SGST or UTGST/IGST components.
- Keep nil-rated, exempt and non-GST distinct. Model export/SEZ as supply treatment separately from product taxability.
- Supplier location and Place of Supply drive tax treatment; GSTIN state is a suggested input, not the sole rule.
- Handle bill-to/ship-to and unregistered buyers explicitly.
- Effective-date rules must not assume invoice date alone resolves every transition; flag supply/payment/date-change exceptions.
- Credit notes use original line snapshots and remaining creditable amounts; check cumulative notes, quantities, taxable amounts and taxes.
- Configure reverse charge, composition/Bill of Supply and export handling without falsely labelling unsupported workflows compliant.
- Full classification and historical rate support; do not restrict valid rates to 0/5/18.
- Confirm applicable HSN digit/reporting requirements against current official guidance; do not blindly truncate stored codes.
- Batch, manufacture/expiry and licence fields should be product-configurable. Do not infer regulatory classification from a name alone.
- Due dates derive from payment terms; preserve explicit overrides.

Invoice Health:
- Invalid GSTIN format/checksum, missing required fields, unverified classification, catalogue mismatch, unusually different buyer price, duplicate number, date inconsistencies and applicable e-way/e-invoice readiness checks.
- Distinguish blocking errors from review warnings; thresholds must be configurable/versioned and account for exceptions.
- Offline GSTIN validation does not confirm registration status or fetch a new party's legal name.
- Online GSTIN lookup, IRN generation and e-way generation require separately configured services; provide honest unavailable/offline states.

Compliance gate:
Before shipping seeded rules or claiming filing compatibility, verify current official notifications, applicability dates, exceptions, reporting formats and thresholds. Prior conversation examples are not an authoritative tax table. The implementation must keep unverified rules visibly unverified.

## 7. Invoice rendering and everyday operation

- Fix duplicated addresses, compressed text and totals overflow using actual reproduction cases.
- Preserve branding and useful workstation behavior.
- Replace forced one-page scaling with readable A4 pagination.
- About 20 short lines is a target, not a guarantee. Use content-aware pagination, repeated table headings, page numbers and reserved footer space.
- Keep rows together where feasible; handle a single oversized description gracefully.
- Totals/signature on final page; optional compact continuation/footer information on other pages.
- Add Place of Supply and Reverse Charge where applicable.
- Appearance controls: bank, terms, transport, ship-to, batch strip, HSN summary, amount in words, discount column, advance/balance, signature, density and copy label.
- Group controls into saved Simple/Detailed/Transport presets, with per-document overrides.
- Never allow a toggle to hide legally required information without a blocking validation or appropriate document-mode rule.
- Print all three labelled copies when relevant; keep page/copy numbering correct.
- PDF exports must contain searchable/selectable text and embedded/local fonts.
- Ctrl+S saves draft; Ctrl+P prints; show saving/saved/failed status.
- Undo for draft edits, duplicate last invoice into a new draft with reset identifiers/payment state, and favourite products.
- Responsive layout for smaller windows and browser/mobile preview where supported.
- WhatsApp: export PDF and open an explicit user-initiated sharing flow. Do not claim a WhatsApp URL automatically attaches a local file; provide manual-attachment fallback. Sending requires internet.
- Keep invoice PDFs as the archival output; do not imply a visual stamp is a cryptographic signature.

## 8. Registers, reports and optional stock

- Searchable/filterable invoice register, outstanding-by-party view and ageing by due date.
- Payment entry with amount, date, method, reference, partial allocation and corrections/audit.
- Separate numbering for each document type and financial year; duplication/cancellation rules.
- Linked partial credit notes with cumulative over-credit prevention and accounting treatment documented.
- Monthly sales and HSN summaries with explicit treatment of cancelled documents and credit dates.
- GSTR-1-style CSV clearly identified as a reconciliation/export format unless tested against the current official import schema.
- Optional stock tracking: opening balances, dispatch/sales, returns and adjustments; do not reduce stock for proforma or double-count challan-to-invoice conversion.
- Optional cost/margin warnings with clear inclusive/exclusive tax assumptions.
- E-invoice readiness fields and validation are distinct from actually generating an IRN.
- Bill of Supply mode must change tax behavior and mandatory content, not just the heading.

## 9. Migration, backups and recovery

1. Inventory sources without overwriting them: disk data, browser origins/ports, localStorage and any existing exports.
2. Create dated source/data backups and record checksums.
3. Provide an export path from the old browser application; filesystem access alone cannot establish all browser records.
4. Reconcile records by stable identifiers and content, showing conflicts. Do not silently choose the largest or newest whole dataset.
5. Preserve legacy rates/totals and document snapshots; missing tax information requires review, not blanket replacement with 5%.
6. Stage migration into a new database, validate counts/references/totals, then switch after successful checks.
7. Make migrations repeat-safe and record their versions. Retain originals and a rollback route.
8. Remove real data from distributed examples; use synthetic fixtures. Exclude local databases, workbooks, exports and backups from git.
9. Inspect tracked history/public exposure separately; removing a current file does not erase past commits.

Backups:
- Automatic dated backups with configurable retention, plus manual Backup/Restore and “last successful backup.”
- Use a consistent SQLite backup API; do not simply copy an active WAL database file.
- Back up before upgrades, imports and restore operations.
- Validate backup integrity and perform an actual restore test.
- Restore into a temporary database first; protect the current database until validation passes.
- Detect disk-full, read-only/missing folders and corrupt files with actionable messages.
- Offer an optional secondary backup folder. A same-disk backup does not protect against disk failure.
- Never delete user data during uninstall or upgrade without explicit user choice.

## 10. Implementation phases and completion gates

### Phase 0 — Audit and baseline
- [x] Read project instructions, inspect git status and inventory current features.
- [x] Back up source/data and capture existing invoice examples.
- [x] Establish baseline tax/print/data behavior and map all persistence paths.
Gate: existing records recoverable; audit and migration strategy documented.

### Phase 1 — Desktop shell and storage
- [x] Electron shell, restricted IPC, single-instance behavior and SQLite schema.
- [x] Versioned migrations, legacy import/reconciliation, backups and restore.
- [x] Bundle local assets and remove live data from examples.
Gate: app launches offline; data survives restart; restore and failed migration tests pass.

### Phase 2 — Business logic
- [x] Extract calculation, validation, catalogue, numbering and document modules.
- [x] Implement mixed tax, snapshots, credit constraints and payment model.
- [x] Add core tests before changing dependent views.
Gate: agreed calculation fixtures pass; issued records remain unchanged after catalogue edits.

### Phase 3 — Print and editor
- [x] Fix layout, pagination, searchable PDF, presets and invoice health.
- [x] Implement draft autosave, undo, duplication and keyboard shortcuts.
Gate: representative 1/20/50-line and long-description documents print without lost content.

### Phase 4 — Excel and reports
- [x] Versioned workbook template, validated preview/import and reliable export.
- [x] Registers, outstanding balances, monthly/HSN reports and CSV export.
Gate: round-trip/idempotence, locked workbook and malformed-input tests pass; report totals reconcile.

### Phase 5 — Remaining workflows
- [x] Batch/licence controls, optional stock/margin, Bill of Supply and readiness fields.
- [x] Copy labels/three-copy printing and user-triggered sharing fallback.
- [x] Document connected-service limitations.
Gate: every originally requested feature is implemented, explicitly optional, or clearly reported as blocked.

### Phase 6 — Package and release
- [x] Pinned dependencies, README, version notes, build scripts and test suite.
- [x] Build Windows installer and/or portable executable; include runtime and licenses.
- [x] Verify launch from shortcut, normal user permissions, folder paths with spaces and Unicode, and repeat launches.
- [x] Test packaged launch/save/restart with an isolated empty data folder and Node/Excel absent from PATH.
- [ ] Test on an independent fresh Windows machine/user profile without development tools (environment unavailable).
- [x] Verify candidate installer/reinstall/uninstall and actual shortcut launch; verify final 3.0.1 packaged and portable payloads. Final installer execution is deferred to preserve a running interactive session. Evidence is in TEST_REPORT.md.
Gate: packaged build passes release matrix; executable and test report delivered.
Code signing is desirable but depends on an available certificate; accurately disclose an unsigned build.

## 11. Required test matrix

| Area | Essential scenarios |
| --- | --- |
| Tax | Mixed rates; intra/interstate; inclusive prices; discount/freight; rounding; fractional quantities; nil/exempt/non-GST; transition review; original-rate credits |
| Documents | Duplicate finalisation; financial-year numbering; cancellation; snapshot immutability; cumulative credit cap; invalid required fields |
| Payments | Partial/full payments; multiple allocations; corrections; credits and outstanding reconciliation |
| Migration | Disk/browser conflicts; missing legacy fields; interrupted migration; repeat import; record counts and financial totals |
| Persistence | Restart; crash during save; stale window; disk-full/read-only errors; unavailable data folder |
| Backups | Active database backup; integrity check; restore; restore failure; upgrade rollback |
| Excel | Export/import round trip; IDs; leading zeros; Unicode; dates; decimals; duplicate rows; formulas; malformed workbook; external edits; locked file |
| Print | 1/20/50 lines; long addresses/descriptions; large totals; hidden columns; fonts; three copies; text extraction; no overlap/clipping |
| Offline | Cold start with network disabled; fonts/styles/icons; invoice creation, save, search, PDF, Excel and restore |
| Security | Restricted IPC; invalid inputs; parameterized SQL; renderer isolation; external-link handling; no live data in package/repo |
| Reports/stock | Totals reconcile; cancelled/credited documents; period boundaries; optional stock reversals and challan conversion |
| Packaging | Fresh Windows profile; no Node/Excel installed; shortcut; repeated launch; normal permissions; upgrade retains data |

Use unit tests for pure business rules, database integration tests, renderer/end-to-end tests and packaged-app smoke tests. Keep synthetic fixtures in tests/. Capture evidence and exact commands/results in TEST_REPORT.md. Investigate failed tests rather than weakening assertions.

## 12. Deliverables and acceptance

Deliver:
1. Updated source and pinned build configuration.
2. Windows executable/installer with a desktop launch flow.
3. Versioned SQLite migrations and safe legacy migration tool.
4. Excel template plus tested import/export.
5. Backup/restore tools and recovery instructions.
6. Readable invoice templates and searchable PDF output.
7. Tests, TEST_REPORT.md, README and release notes.

Release acceptance:
- User can launch and perform ordinary billing completely offline.
- Existing records migrate without unexplained count/amount differences.
- Issued invoices remain historically stable.
- Tax and payment totals reconcile across UI, database, Excel, PDFs and reports.
- No known data-loss or incorrect-total defects remain open.
- No unreported feature gaps or unsupported compliance claims.
- Final report distinguishes automated tests, manual checks, untested environments and external-service dependencies.

## 13. Prompt to start the implementation session

“Read INVOICE_STUDIO_IMPLEMENTATION_PLAN.md in this project. Implement it in phase order, preserving my current design and existing data. Use SQLite as the primary offline database and Excel for validated import/export. Package a double-click Windows app. Inspect current code first, back up before migration, test each phase and the packaged application, and finish with the output files and an honest test/limitations report. Do not stop after planning or claim untested features work.”


## 14. Implementation decisions confirmed by the user

On 26 October 2026, the user confirmed all existing records are samples, the folder is current, and the application should start empty after backup. Both installer and portable executable were requested; retain the current design and leave optional stock disabled. Samples were archived with hashes before edits and are excluded from packages.

Implemented modules: desktop/main.cjs (lifecycle/IPC/file dialogs), desktop/store.cjs (SQLite/migrations/ledger/backup), desktop/workbooks.cjs (Excel/CSV), desktop/legacy.cjs (JSON-only recovery), shared/core.js (decimal rules/health/reports), shared/invoice-view.js (print content), js/studio.js (workstation).

Unconfigured connected services, legacy ledger reconciliation, number-series capacity, accounting/refund scope and untested environments are explicitly documented in README.md and TEST_REPORT.md. Checklist completion describes implemented local features; it does not imply statutory certification or a tested independent fresh OS.
