# Nursing Workforce Calculator (Google Apps Script)

A Google Sheets–backed calculator for RN, CNC and PCA/PCT workforce planning.
It has four pages (Summary, Inpatient, Other & OPD, Settings) with editable,
Excel-like tables. Numbers update as you type, and Save writes them to the sheet.

> **Planning tool only.** All ratios, hours and minimums are planning
> assumptions that need local approval. They are not mandatory clinical
> standards. "Coverage Met" means the entered assumptions are met. It does not
> certify clinical safety.

## Files

| File | Purpose |
| --- | --- |
| `Calculations.gs` | The shared calculation engine (pure JS). The server and the browser run the same code. |
| `Config.gs` | Sheet names, column layout, seed units from *Nursing Manpower Calculator.xlsx*. |
| `Setup.gs` | `initializeSystem()` (idempotent) and header-based sheet read/write helpers. |
| `Code.gs` | `doGet`, `getAppData`, `saveAppData` (sanitise, re-validate, lock, revision check), menu, Results sheet. |
| `Index.html` / `Styles.html` / `Scripts.html` | UI. The engine source is injected into `Index.html` by `Code.gs`. |
| `appsscript.json` | Manifest (V8, scopes, web-app settings). |
| `tests/` | Node tests with an in-memory Apps Script mock, plus a Playwright UI smoke test. Excluded from `clasp push`. |

## Deploy

1. Create a Google Sheet, then open **Extensions → Apps Script**.
2. Copy each `.gs`/`.html` file into the project under the same name, and replace
   `appsscript.json` (turn on *Project Settings → Show "appsscript.json"*).
   Or use clasp: copy `.clasp.json.example` to `.clasp.json`, set the script ID,
   and run `clasp push` from this folder.
3. Run `initializeSystem` once from the editor and grant the permissions.
   This creates the sheets and seeds the 25 workbook units. Running it again
   only adds missing sheets, columns or settings. It never overwrites saved data.
4. Reload the Sheet. Open the app with **Nursing Workforce → Open calculator**, or
   use **Deploy → New deployment → Web app**. The manifest sets
   *Execute as: me* and *Access: my domain*; change these to fit your policy.

## Use

- **Settings:** reporting month, weekly hours (48), shift length (12), and an
  optional scheduled-hours override. Choose one FTE method (deduct unavailable
  hours **or** relief uplift). Also set overtime limits, support-staff
  headcounts (PCA/PCT 54, CNC 35), optional costs, CNC direct-care
  contributions, archived units and the data-quality list.
- **Inpatient:** beds, occupancy, patients per RN (or acuity groups), a minimum
  RN per shift for each unit, the schedule including Fridays, and current
  headcount and FTE. Open **details** to set the shift census, subset or
  duplicate status, and manual overrides.
- **Other & OPD:** each unit uses one method: OR, ER (volume × acuity by
  period), Delivery, Procedure (Endoscopy and Cathlab are separate), CSSD
  (RN posts; technicians reported separately), OPD clinic-based **or**
  activity-based, or Fixed posts.
- **Summary:** cards, the unit table, transfers, overtime and cost options, and
  reconciliation checks.
- **Save** is blocked while validation errors exist. **Reset to Saved** reloads
  from the sheet after you confirm. Archiving asks for confirmation and can be
  undone in Settings.

## Tests

```bash
npm run test:gas   # engine + server tests (node:test), also run by `npm test`
npm run test:ui    # browser end-to-end smoke test (needs Playwright/Chromium)
```

See `PROJECT_MEMORY.md` for calculation definitions and design decisions.
