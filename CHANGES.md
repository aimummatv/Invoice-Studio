# Review fixes

## Bugs fixed
- **"New blank invoice" was not blank**: it came pre-filled with a fake buyer, GSTIN, e-way bill, driver, vehicle, LR, batch and a fake UTR/₹25,000 advance. Empty fields also fell back to those fake values in the invoice and WhatsApp snippets. Now truly blank.
- **Tax rate hard-coded to 12%** in 14 places; the stored cgst/sgst/igst rates were ignored. Now one per-document `gstRate` (dropdown); labels, HSN table and credit-note reversal follow it. New docs default to 5%; old docs stay 12%.
- **Invoice numbers** were random 3-digit numbers (duplicates possible) and the financial year flipped on 1 Jan. Now sequential per Apr–Mar FY (`MR/2026-27/0101`, `…/0102`, …).
- **Rounding**: line totals and tax are now rounded to paise at each step (no 0.1+0.2-style drift).
- **Amount in words**: 10.999 produced "undefined Paise"; ≥100 crore produced "undefined". Fixed.
- **E-way bill alert** fired at ₹50,000 exactly; the rule is "exceeding" ₹50,000.
- **GST state list** covered 10 states; now all state/UT codes. GSTIN fields get live format + checksum validation.
- **Quotes/`<`/`&` in names broke inputs and were injected as HTML**; free-text fields are now escaped.
- **Supply-type change** left the "Tax Breakdown" label stale; the editor now refreshes.
- Unit-rate input step was 0.5 (browser flagged ₹46.75 as invalid); now 0.01.

## Server hardening
- Listens on 127.0.0.1 only (was 0.0.0.0 with `Access-Control-Allow-Origin: *` and an unauthenticated endpoint that overwrites `data/mock-data.js`).
- Rejects foreign Host/Origin, non-JSON bodies, bodies >5 MB, malformed payloads; atomic write with `.bak` backup.
- Fixed crash on malformed URLs, prefix-style path escape, and serving of `.git`/`server.js`. Added Linux browser launch.

## Offline / privacy
- html2pdf.js, lucide and a QR generator are bundled in `lib/` (pinned). UPI QR is generated locally instead of sending your UPI ID and amount to api.qrserver.com.
# Version 3.0.1 - offline desktop upgrade (26 October 2026)

See RELEASE_NOTES.md, README.md and TEST_REPORT.md for the implemented desktop workflows and verification. SQLite is authoritative, samples are backed up, fresh launches have no business records, and new taxable lines have no assumed GST rate. The review notes below describe the earlier browser edition and are historical.

