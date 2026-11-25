# Budget — receipts & spending

A phone-first web app (installable on Android from Chrome, also works on a PC):

- **Add an expense** — type the amount and pick a category, or pick a category and scan the receipt.
- **Free receipt scan** — the receipt is read on the phone itself (Tesseract OCR, Japanese / English / Russian).
  No server, no subscription. It finds the total, the date and the currency, and shows the other amounts it saw
  so you can tap the right one if it guessed wrong. Tilted photos are straightened automatically.
- **Paper receipts to hand in** — receipts are marked *To hand in* until they're collected. Select them
  (all, a month, or one by one) and tap **Hand in**: they're kept together as a dated batch with its total.
  Old receipts can be added as *Handed in*, and a batch can be renamed or undone.
- **Budget** — monthly totals per category, optional monthly budgets, several currencies
  (converted to your main currency with daily [Frankfurter](https://frankfurter.dev) rates).
- **Sync** — sign in with Google on the phone and the PC to share one budget (same Firebase project as Deckscan).
- **Export** — CSV for Excel / Google Sheets.

## Files

| Path | What |
| --- | --- |
| `js/app.js` | Screens (Preact + htm, no build step) |
| `js/parse.js` | Finds total / date / currency in the OCR text |
| `js/ocr.js` | Photo clean-up (straighten, even out shadows) + Tesseract |
| `js/store.js`, `js/sync.js` | Data on the phone + Firebase sync (`users/{uid}/budget*`) |
| `vendor/` | Bundled libraries and the OCR engine + language data, so nothing loads from a CDN |

## Development

```bash
npm install && node scripts/vendor.mjs      # only needed to update the libraries
python3 -m http.server 8080                 # open http://localhost:8080
node test/parse.test.mjs                    # receipt text parsing
python3 -I test/e2e_scan.py .               # fake phone photos -> Scan -> checks the amount (needs Playwright)
```

Hosted on GitHub Pages from `main`. Firestore rules (shared with Deckscan) only let each signed-in user read and
write their own `users/{uid}/...` documents.
