# Invoice Studio 3.0 implementation and test report

Date: 26 October 2026 (India). User choices: original records are samples; start empty after backup; no newer browser data; preserve the workstation design; deliver installer and portable executable; optional stock off.

## Delivered implementation

- Electron 45.0.0 desktop shell; per-user/explicit portable data folder; single-instance locking; offline assets/fonts; restricted named IPC; renderer sandbox/context isolation; Node integration disabled; external network and navigation blocked.
- SQLite schema version 1 with transactions, foreign keys, migration metadata, optimistic draft revisions, document lines/tax groups, immutable/hash-checked issue snapshots, independent number series, payment allocations, audit/import/export/backup histories and optional stock.
- Actual draft autosave and explicit save, issue/cancel/duplicate/convert, original-rate partial credits with cumulative caps and exact final paise, recorded advances and allocation at issue, corrections and current balances.
- Decimal calculations, mixed GST, inclusive prices, discounts, proportional fees, fractional quantities, percentage cess, explicit rounding, nil/exempt/non-GST separation, tax-evidence review and Bill of Supply/export/SEZ/readiness fields.
- Readable A4 PDF/print, repeated headings, selectable text, labelled copies, presets, undo, favourite customers/products, catalogue/buyer agreements, invoice register, ageing/monthly/HSN reports, manual WhatsApp attachment flow.
- Versioned 12-sheet workbook/template, preview/conflicts/row errors, IDs/revisions, atomic imports, formula/macro/ZIP limits, locked-file preservation, external-change protection, managed automatic export and reconciliation CSV with explicit round-off.
- Source/sample backup with hashes, consistent SQLite backups, integrity/restore, configurable retention and secondary folder, legacy JSON-only recovery with conflicts and preserved original records.

## Environment and commands

Local Windows 11 x64 (build 26200), Node 24.19.0 for tests, Electron 45.0.0/its bundled Node and Chromium for desktop. Bundled Python/Poppler and artifact-tool were used for artifact verification. Tests contain fictitious data only; databases/screenshots/PDFs are under ignored `test-output/`. No real customer data was uploaded or packaged. No Git repository existed in this folder.

| Command / check | Result |
| --- | --- |
| `node --check server.js`, `node --check js/studio.js`, `node --check desktop/main.cjs` | Passed |
| `npm test` | 34 tests passed; 0 failed/skipped |
| `npm run test:desktop` | Passed sequentially: UI business/customer/product entry, save/issue, payment allocation, restart, sandbox/context isolation, no renderer require, blocked network, screenshots, 1/20/50-line PDFs |
| `scripts/verify-pdfs.py` with pypdf and Poppler | All line labels found; long-description terminator retained; totals on final pages; labels/copy variants present |
| Template creation and render using bundled artifact-tool | 12 sheets created/rendered; IDs, examples, frozen headers, validation; saved template passes app importer and keeps `001234` as text |
| `npm audit` after pinned compatible overrides | 0 known vulnerabilities at implementation time |
| `npm run dist` | Windows x64 NSIS installer and portable executable built, unsigned |
| Packaged app with isolated Unicode/spaced folder and PATH limited to Windows System32 | Empty start, save and restart passed; Node/Excel absent from PATH |
| 3.0.0 candidate installer lifecycle | Install, actual desktop shortcut, same-release reinstall and uninstall passed; test database preserved |
| Final 3.0.1 packaged executable | Isolated-profile fresh start, save/restart and offline desktop APIs passed |
| Final 3.0.1 portable wrapper | Actual extracted child launch, adjacent explicit data, restart, initialized marker and normal-config isolation passed |
| Final package/source comparison | 19 shipped source/asset/template files match current bytes; no root sample/test/backup data in archive |

Installer lifecycle evidence was captured on the 3.0.0 development candidate using the same NSIS settings: install, actual Unicode desktop-shortcut launch, same-release reinstall and uninstall all preserved the isolated test database. Final 3.0.1 payload verification uses isolated profiles. An interactive 3.0.0 portable session was subsequently opened and locked the earlier executable; it was preserved. Version 3.0.1 is delivered separately rather than interrupting that session. Final 3.0.1 installer install/uninstall is not repeated while an interactive session is running. The production renderer remains sandboxed.

## What the automated tests establish

Pure rules cover mixed/intra/interstate rates, inclusive prices, fees/discounts/cess, fractional quantities, distinct taxability, reverse charge/LUT treatment, April financial years, date arithmetic, checksum validation, suggestions, amount words, negative/invalid inputs, and a regression against double rounding six-place quantity × price.

Database tests cover restart, stale revisions, idempotent finalisation, unique sequences and cancellation retention, immutable issued snapshots after business edits, duplicate resets, partial payments/over-allocation rollback, correction history, cumulative credits including original-rate and final fractional paise/round-off, single allocation of an advance, active-WAL backup/actual restore, corrupt restore rejection, missing configured folder, read-only save failure, killed-process transaction rollback, and no double stock deduction on challan conversion.

Workbook tests cover template/current export round-trip, stable-ID reimport, leading zeros, formula rejection, malformed/oversized archive, version rejection, stale row conflicts and atomic rollback, report-only protection, unverified imported tax rules, JSON-only legacy recovery/idempotence/original totals, literal formula-looking text, CSV escaping and numeric credits, explicit round-off. A real Windows exclusive file lock was held by a hidden helper while export was attempted; original bytes remained intact.

## PDF / visual evidence

| Fixture | Pages | Result |
| --- | --- | --- |
| 1 line | 1 | Selectable text, line retained, readable totals/signature |
| 20 lines, three labelled copies | 6 | Two pages per copy; all three copy labels and all lines retained |
| 50 lines including a roughly 6,000-character description | 7 | Description continues across pages, terminator retained, no forced shrink, totals on final page |

Screen and rendered page evidence: `test-output/workstation.png`, `reports.png`, `small-window.png`, `packaged-fresh.png`, `packaged-restart.png`, `pdf-evidence.json`, `pdf-text-checks.json`, `desktop-result.json`, `packaged-result.json`, plus rendered PDF pages/contact sheets. Screens were visually reviewed; the small preview was changed to horizontal scrolling to prevent compression.

## Fixes found by verification

Tests exposed and fixed a payment SQL placeholder mismatch, fractional-credit accumulation, Windows restore file-lock behaviour (restore now uses SQLite backup transactionally), double paise rounding, exact final-credit rounding/round-off, and reverse-charge recipient tax separation in reports. The generated workbook used valid XML namespace prefixes unsupported by ExcelJS's default parser; the import path now normalises those element prefixes in memory, without executing or overwriting the input. The first installer artifact filename used an unsupported build macro; it was corrected. A stalled runtime download was bypassed by packaging the already downloaded official runtime.

Two simultaneous desktop harnesses conflicted with the intended single-instance/cache lock; final desktop checks were run sequentially. An overlapping rebuild interrupted an archive operation; the final build was rebuilt sequentially. The Windows PowerShell test script needed explicit UTF-8 JSON reading. WScript's ANSI shortcut-target property best-fitted a Greek filename to a Latin character; the actual Unicode link target and actual shortcut launch were verified instead. The portable stub starts a child process, so its harness connects directly to the child's local test port. These were harness/build iteration failures, not remaining pass claims. Physical printer output is not inferred from successful PDF generation.

## Limits and untested environments

- No independent fresh Windows VM/user account or Windows 10 machine was available. Removing Node/Excel from PATH tests dependency independence, not a genuinely fresh OS. Hardware printer/drivers, disk-full hardware failure, power loss at arbitrary instants and large-scale load were not tested. A killed transaction and SQLite read-only mode were tested.
- The only release schema is version 1. A new database and same-release reinstall can be tested; a future schema upgrade/downgrade is not claimed tested. Future migrations must back up before changing schema. No code-signing certificate was supplied.
- The final 3.0.1 installer is built; lifecycle installation was exercised on the 3.0.0 candidate. The 3.0.1 unpacked and portable payloads are tested separately with their own diagnostic profiles. The running interactive session and its data are not changed by these tests.
- GST registration lookup, IRN generation, e-way generation and official filing/schema validation are unavailable. No tax classifications/rates are seeded as verified. Review applicability, HSN digit requirements, transition exceptions and current official evidence for the actual business.
- Cess supports percentage amounts from 0–100%; specific/per-unit cess and higher percentage cess require an additional calculation implementation and are not claimed supported.
- Default number series capacity is 9,999 per document type/year. A new series implementation/configuration is required above that capacity.
- Legacy records preserve raw amounts/rates and references. Conflicting IDs require review; historical payments/attachments are recovered as raw evidence rather than silently becoming ledger entries. Legacy invoice tax/line/payment reconciliation is needed before credits. The user selected a fresh database, so no sample data was migrated automatically.
- Outgoing refunds, full general-ledger accounting, inventory valuation and realised P&L are outside this release. Negative balances represent customer credit. Optional stock tracks quantities and can be enabled; it is off by default.
- PDF copies are searchable archival visual documents, not cryptographically signed documents. WhatsApp attachment and sending are manual user actions with internet required.

## Final release evidence

`release/Invoice-Studio-3.0.1-Setup-x64.exe` and `release/Invoice-Studio-3.0.1-Portable.exe` are the final unsigned outputs. `release/RELEASE-MANIFEST.json` records byte sizes, SHA-256 checksums and the 19 source/asset/template comparisons. Original 16-file backup checksums were rechecked successfully.

Final runtime evidence was captured in `test-output/packaged-result.json` (version 3.0.1) and `test-output/portable-result.json`, alongside candidate installer lifecycle records. Workspace cleanup subsequently removed generated test profiles, logs, screenshots, PDFs and older builds. This report retains the results; the scripts in `scripts/` reproduce the checks. No current user database was cleared, restored or replaced.

Version 3.0.1 uses schema 1; existing records stay in the configured data folder. Independent fresh-OS testing and final installer execution remain explicitly untested as noted above. The final executables and checksum manifest are distributed through GitHub Releases; local backups and generated test outputs are excluded from Git.

No known incorrect-total or data-loss defect remains from the exercised scenarios. This is not a claim of zero bugs or statutory certification. Sources and recovery instructions are in README.
