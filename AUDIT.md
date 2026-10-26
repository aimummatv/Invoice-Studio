# Baseline audit - 26 October 2026

The 16 original files were copied to `Backups/source-before-desktop-20261026-160141/` before application edits. `SHA256-MANIFEST.json` records every original file's size and SHA-256. The folder was not a Git repository; there is no local tracked history to audit.

The user confirmed that the 2 orders, 8 contacts, 4 products, 2 payments and 6 document references are samples, that the folder contains the latest data, and that the new database should start empty. Originals remain recoverable. No automatic sample import will run. Stock tracking is optional and disabled. Both portable and installed Windows builds are requested; preserve the workstation's existing Magic Roots design.

## Observed defects and persistence paths

- `loadData` preferred `INVOICE_STUDIO_DATA_V1` in browser localStorage over the disk seed. Each browser origin/port had an independent copy.
- `saveData` wrote localStorage and POSTed the entire dataset to `/api/data`; server errors were swallowed. The server overwrote executable JavaScript, not SQLite.
- `saveStudioDraft` only cleared a dirty flag and displayed a success toast. Issuing several document types only mutated memory and/or downloaded a PDF.
- A repeated advance action could add the same amount repeatedly without an allocation ledger.
- Duplicate drafts used random IDs/numbers and retained payment data. Existing number logic did not cover separate document series.
- Calculations used one document rate, binary floating point and integer-only quantities. HSN was hard-coded in rendered output.
- Print used remote fonts and Tailwind, forced no page breaks, and clipped overflow. PDF used raster html2canvas output.
- Blank creation still inserted a sample product. Several fallback addresses, telephone numbers, batches and transport values were invented.
- No package manifest, tests, Electron shell, Excel workflow or database existed. Initial JavaScript syntax checks passed.

## Implementation and migration decisions

SQLite in the main process is authoritative. The renderer cannot access Node or arbitrary IPC. Issued snapshots, line/tax tables, ledger allocations, series and audit events are transactional. Browser mode is an explicit read-only preview, not another database.

Legacy JSON/JavaScript imports are parsed as data, never evaluated. Imported issued records preserve legacy totals and rates and are flagged for review. Imports preview record conflicts and require a consistent backup before committing; conflicting issued records cannot be overwritten. The samples are excluded from both packages.

No official tax classification is seeded as confirmed. Rate/classification verification and connected IRN/e-way/GSTIN services remain explicit business review steps. Current reference links and release limitations belong in README and TEST_REPORT.
