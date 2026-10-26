# Included third-party software

Electron 45.0.0 and Chromium/Node/SQLite licenses are distributed with the runtime (`LICENSE.electron.txt`, `LICENSES.chromium.html`). Electron uses SQLite's supported online backup API through `node:sqlite`.

Runtime modules: decimal.js 10.6.0 (MIT), ExcelJS 4.4.0 (MIT), JSZip 3.10.1 (MIT/GPL dual license, used under MIT), and their locked dependencies. Dependency license files are retained in the application archive.

Plus Jakarta Sans and JetBrains Mono fonts: SIL Open Font License 1.1; full license files are included here. Decimal's license is included here.

Existing locally bundled browser libraries: Lucide 0.468.0 (ISC), qrcode-generator 1.4.4 (MIT). Their copyright/license notices are retained in their source files. html2pdf and PDF.js are preserved in the original source backup but are not needed or distributed by the desktop app.

Magic Roots branding and the invoice workstation source belong to the project owner. No code-signing certificate was provided; release executables are unsigned.
