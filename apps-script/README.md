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

## Offline version (single HTML file)

`standalone/nursing-workforce-calculator.html` is the same app in one file: open it in any browser, no Google account
or internet needed. Data is saved in that browser; use **Export data** / **Import data** for backups or to move to another
computer, and **Start over** to restore the workbook example. Rebuild it after changing `apps-script/` with
`npm run build:standalone`.

## Deploy (step by step)

**A. Create the Sheet and the script project**
1. Go to <https://sheets.new>. Name the new spreadsheet, for example *Nursing Workforce Calculator*.
2. In the Sheet, click **Extensions → Apps Script**. This opens a script project bound to the Sheet.
3. Rename the project (top left) to *Nursing Workforce Calculator*.

**B. Add the files** (manual copy; the clasp alternative is in step 7)

4. Click the gear icon (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
5. Go back to the **Editor**. Delete the default contents of `Code.gs` and paste this repo's `Code.gs`.
6. For each remaining file, click **+ → Script** or **+ → HTML** and enter the name **without the extension**. Then paste the contents:
   - Scripts: `Config`, `Calculations`, `Setup`
   - HTML: `Index`, `Styles`, `Scripts`
   - Replace the contents of `appsscript.json` with this repo's version.

   Save all files (Ctrl/Cmd + S). File order does not matter.
7. *Alternative:* install clasp (`npm i -g @google/clasp`) and run `clasp login`. Copy
   `.clasp.json.example` to `.clasp.json`, set `scriptId` (found under Project Settings → IDs), then run
   `clasp push` from this folder. Test files and Markdown files are excluded by `.claspignore`.

**C. Initialise**

8. In the editor, choose `initializeSystem` in the function drop-down and click **Run**.
9. Authorise when prompted: **Review permissions →** choose your account **→ Advanced → Go to …
   (unsafe) → Allow**. Google shows the "unsafe" warning for any unverified personal script.
10. Check the **Execution log**. It should list the sheets it created and end with *Seeded 25 units from the workbook*.
    Running it again should report *System already initialised — nothing changed.*

**D. Open the calculator**

11. Reload the Sheet tab. A **Nursing Workforce** menu appears (it may take a few seconds).
    Choose **Nursing Workforce → Open calculator** to open the app in a dialog.
12. Optional full-page web app: in the editor click **Deploy → New deployment**, then the gear icon **→ Web app**.
    Set *Execute as* **Me** and *Who has access* **Only myself**. Click **Deploy** and open the **Web app URL**.
    To share it, change the access setting and share the Sheet with the colleagues who need it.
    After you change the code later, update the deployment with **Deploy → Manage deployments → Edit → New version**.

**E. First checks in Google** (these cannot be tested outside Google)

13. Edit an input, click **Save**, reopen the calculator, and confirm the value persisted. Also confirm the `Units`,
    `Results` and `Audit_Log` sheets updated.
14. Run **Nursing Workforce → Initialise / repair sheets** and confirm it reports *nothing changed*.
15. On the **Settings** sheet tab, check that `reportingMonth` still shows `YYYY-MM` text and has not been converted to a date.

**Updating an existing install:** replacing the files and reopening runs any pending migration once (v3 switches
Other units to manual Required FTE, prefilled with their current values; v4 keeps the OPD clinic formula and fills
beds / clinics from the workbook).

**Updating an existing v1 install:** replace all 8 files, then reload the Sheet and open the calculator (or run
`initializeSystem`). This runs the one-time v2 migration:
- adds a `unit_type` column and a `Contributions` sheet
- converts any `CNC_Contributions` rows from hours to FTE allocations

Saved inputs are not overwritten. The `Audit_Log` records what was migrated.

## Use

**Simple view (default).** The app opens in a simplified view. The **Simple / Full** switch at the top changes it, and the browser remembers your choice.
- **Summary:** one headline answer (nurses needed), 4 cards (Required, Available, Shortage, Staff headcount) and a
  "Needs data" list. Click a unit in the list to jump straight to it. The unit table is sorted by largest shortage.
- **Inpatient:** main inputs, nurses now, required FTE, gap and status. **▸** opens a short panel with the unit's
  inputs, staff and hours, and its result, including exactly which data is missing.
- **Other & OPD:** one table — Unit, **Beds / Clinics**, **Required FTE**, **Nurses now**, Gap and Status. Type the
  required FTE for each unit; beds / clinics is for reference. **OPD – Surgical and OPD – Medical keep their clinic
  formula** (clinics × active % × RN per clinic × opening hours): every part of the formula is editable in the row and
  the required FTE recalculates as you type. No methods, lists or detail panels. Add Unit asks only for a name (optionally beds / clinics and required
  FTE). Calculated methods remain in Full view.
- **Edit / rename / delete a unit:** the **✎** next to a unit name (Inpatient and Other & OPD) opens a small dialog:
  rename (blank or duplicate names are refused), open/close, or **Delete unit**. A deleted unit leaves all
  calculations but keeps its data; **Settings → Deleted units** lets you **Restore** it or **Delete permanently**
  (also removes its CNC/PCA allocations and transfers; applied when you press Save, recorded in `Audit_Log`).
- **Settings:** 10 basic fields, plus the Deleted units list.
- Everything else is in **Full view** (described below). Both views use the same data and calculations.

**Full view:**

- **Summary (executive dashboard):**
  - Six headline cards: Required FTE, Current RN FTE, CNC contribution,
    PCA/PCT contribution, Final planning shortage and Total headcount.
  - A waterfall showing how each credit changes the final gap.
  - Estimated overtime cards: uncovered hours, feasible OT hours, estimated OT
    cost, remaining recruitment FTE.
  - The unit table, transfers, cost options and reconciliation checks.
- **Inpatient / Other & OPD:**
  - A simple table: Unit, Key inputs, Required FTE, Current RN FTE, CNC,
    PCA/PCT, Remaining gap, Status.
  - The **Estimated overtime** toggle swaps in the overtime columns.
  - **▸** opens the advanced inputs: unit type and method, schedule and
    minimum, average vs whole-shift FTE, override, staffing and overtime
    eligibility, CNC/PCA allocations, relations, calculation trail.
- **Settings:**
  - Hours per FTE and the requirement basis.
  - Overtime: 48 h default, eligibility.
  - Support staff: headcount, FTE, default %s, PCA cap, approval flags.
  - Costs, the allocation table, archived units and data quality.

**Leave & Absence Coverage (optional):** off by default, so Final Required FTE = Base Required FTE (required hours ÷
available monthly hours per FTE). Tick **Include Leave & Absence Coverage** (unit panel or Settings, both views) to
multiply by the Coverage / Relief Factor (default 1.17, 1.00–1.50). The unit Result card shows Base, Coverage,
Final, Available, Gap and Overtime Needed.

**Gap sign:** required − credited. Positive = **▲ Shortage** (red); negative = **▼ Surplus** (green).

**Two results:**
- The **RN coverage gap** credits qualified RN and CNC direct care, plus
  confirmed transfers.
- The **adjusted workforce planning gap** also credits approved PCA/PCT
  support tasks. It is labelled a *planning scenario* until the contribution
  assumptions are approved in Settings.

**Saving:** Save is blocked while validation errors exist. Reset to Saved,
archive and delete actions all ask for confirmation.

## Tests

```bash
npm run test:gas   # 81 engine, server and Apps Script-compatibility tests (node:test); also run by `npm test`
npm run test:ui    # browser end-to-end test (142 checks; needs Playwright/Chromium)
```

See `PROJECT_MEMORY.md` for calculation definitions and design decisions.
