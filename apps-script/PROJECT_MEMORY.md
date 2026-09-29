# PROJECT_MEMORY — Nursing Workforce Calculator (Apps Script)

This file records the calculation definitions, assumptions, structure and
decisions. Update it whenever the engine changes.

## 1. Origin and workbook corrections

The seed data comes from *Nursing Manpower Calculator.xlsx*. It uses the
workbook's unit names, beds, occupancy, ratios and current RN counts. The
workbook's formulas were **not** copied. The table lists the known workbook
errors and what this app does instead:

| Workbook problem | Where | Correction |
| --- | --- | --- |
| Recruitment = Required − (RN + PCA/PCT + CNC) | V2 `M10 = D6 − G10`, old sheet `L50 = K50 − H50` with `J50 = 89` | Recruitment = Σ unit shortages remaining after valid transfers. PCA/PCT is never subtracted. |
| OR sized by beds × occupancy ÷ ratio | V2 row 57, old row 33 | OR = rooms × operating hours × RN roles (+ prep/recovery/emergency only when not already included). |
| Overtime references drift (`O12*C5`, `O13*C6`, …) | old col P | One overtime limit applies to all units; feasible OT = MIN(uncovered, eligible HC × limit). |
| Rows omitted from totals | old `M38/N38 = SUM(…32:36)` skips Anesthesia; hard-coded `L28`, `L38` | All totals are sums of the unit results; reconciliation checks run on every calculation. Current RN = 392. |
| Inconsistent relief (1.15 inpatient, 1.5 other) and OPD Medical 24 h vs 12 h | old cols M, row 44 | One hours-per-FTE divisor for every unit. OPD Medical uses 12 h (flagged to confirm). |
| Relief added on top of hours that already allowed for absence | V2 `K = J ÷ 208 × 1.15` | Two mutually exclusive modes (see §3). |
| ER and CSSD by bed occupancy; Endoscopy/Cathlab combined; DR vs Delivery Room–NU possibly duplicated; ICU/NICU ventilated/isolation rows possibly subsets | various | Dedicated methods; Data Required until workload data exists. The rows are split. Relations are flagged *Unresolved*, which keeps the totals provisional. |

## 2. Storage (Google Sheets)

| Sheet | Key | Content |
| --- | --- | --- |
| `Settings` | `key` | One row per setting (`value` is stored as text). |
| `Units` | `unit_id` (stable, never reused) | Common fields as columns. Method inputs are in `params_json` as `{METHOD: {...}}`, so switching method loses nothing. |
| `Transfers` | `transfer_id` | source, destination, FTE, competency_confirmed, coverage_compatible. |
| `CNC_Contributions` | `contribution_id` | cnc_ref (employee reference), unit, qualified, total/admin/direct-care hours. |
| `Results` | — | Derived output, rewritten on each save. Do not edit. |
| `Audit_Log` | — | Setup and save events. |
| `_Meta` | `key` | `seeded`, `revision`, `saved_at`, `saved_by`, `schema_version`. |

Columns are read and written **by header name**. New columns are appended, and
columns added by users are kept. Units are never deleted, only archived. A
save that omits a saved unit keeps it. Saves need the current `revision`
(optimistic concurrency) and run under `LockService`.

## 3. Hours and FTE

- Scheduled hours per FTE = weekly hours × calendar days ÷ 7, unless there is a manual override.
  With 48 h, this is 205.71 h in a 30-day month and 212.57 h in a 31-day month (the workbook used 208 = 48 × 52 ÷ 12).
- **DEDUCT mode** (default): hours per FTE = scheduled − leave − training − other unavailable (defaults 20 + 4 + 6).
- **UPLIFT mode:** hours per FTE = scheduled ÷ (1 + uplift). The leave fields are ignored.
- Required FTE = coverage hours ÷ hours per FTE, rounded to 2 dp. Establishment = CEIL per unit, shown separately.
- Supply hours = FTE × the same hours-per-FTE, so both modes stay consistent.
- Current FTE can be entered separately from headcount. If it is blank, FTE = headcount (the app notes this).

## 4. Opening schedule

Each unit has regular open days (from Sat, Sun, Mon, Tue, Wed, Thu), hours per
regular day, **Friday hours** and public-holiday hours. The month's actual
weekday counts are used. The number of holidays in the month is a global
setting; holidays are assumed to fall on regular open days.
Open hours = regular days × weekday h + Fridays × Friday h + holidays × holiday h.

## 5. Methods (required RN coverage hours per month)

"min" = unit minimum RN × open hours. It applies only to open units.

| Method | Formula |
| --- | --- |
| RATIO | avg RN = MAX(beds × occ% ÷ patients per RN, min RN/shift); hours = avg RN × open hours. Shift RN (whole) = MAX(CEIL(census ÷ ratio), min), where census = entered shift census, or CEIL(avg occupied) (flagged as an assumption). |
| ACUITY | Mutually exclusive groups: avg RN = MAX(Σ patientsᵢ ÷ ratioᵢ, min). Duplicate group names, or Σ patients > beds, are errors. |
| OR | rooms × RN roles × open h + prep (rooms × min/day × open days) + recovery RN × open h, then MAX with min; plus emergency RN × hours outside the schedule. Each extra is added only if its "already included" box is unticked. |
| ER | For each period: MAX(Σ cases × min ÷ 60, period min RN × period h × days). Period hours must be ≤ 24. Workload rows must reference a defined period, with no duplicate period/acuity rows. |
| DELIVERY | MAX(deliveries × RN h per delivery + other assessments, min). |
| PROCEDURE | MAX(n × (min × roles + prep) ÷ 60 + recovery n × min ÷ 60 ÷ patients per recovery RN, min). Recovery is skipped if it is staffed elsewhere. |
| CSSD | RN = MAX(RN posts, min) × open h. Technician FTE = sets × min ÷ 60 ÷ hours per FTE. It is reported separately and is **not** RN demand. |
| CLINIC (OPD A) | MAX(clinics × active% × RN per clinic, min) × open h. |
| ACTIVITY (OPD B) | MAX(activities × min ÷ 60 + support h, min). Only one OPD method is active at a time. |
| POSTS | MAX(posts, min) × open h. |

Missing inputs give **Data Required** (FTE = null, never 0) and make the totals
provisional. A **Manual Override** needs a reason; its hours = FTE × hours per FTE.
**Closed** units have no requirement. Their staff count as surplus.

## 6. Gap, CNC, transfers, recruitment

- Effective FTE = current RN FTE + eligible CNC FTE. A CNC counts only when
  *qualified*, assigned to an active unit, and has direct-care hours > 0.
  Admin/supervision hours are excluded. Direct + admin must be ≤ total. One
  CNC ref cannot be credited above one FTE, and the number of CNC refs cannot
  exceed CNC headcount.
- Net gap = Effective − Required (Current − Required). Shortage = MAX(0, −gap). Surplus = MAX(0, gap).
- Status: Closed, Data Required, Manual Override, Coverage Gap (gap < 0) or Coverage Met.
- Transfers are evaluated in table order. A transfer is valid only when all of these hold:
  - competency ✓ and compatibility ✓
  - FTE > 0 and source ≠ destination
  - both units are counted, and the destination is open
  - the source requirement is known
  - FTE ≤ the source's remaining RN FTE (CNC credit is not transferable)
  - FTE ≤ the source's remaining spare, so the transfer never creates a source shortage
- Recruitment FTE = Σ MAX(0, −post-transfer gap). Posts = Σ CEIL per unit.
- PCA/PCT headcount is shown separately and never reduces RN need.
- Total workforce HC = RN HC + PCA/PCT HC + CNC HC. CNC credit adds no headcount.

## 7. Overtime and cost

- Uncovered hours = MAX(0, coverage h − post-transfer effective FTE × hours per FTE).
- Feasible OT = MIN(uncovered, eligible HC × max OT per RN). Eligible HC is the
  unit's value, or else FLOOR(current HC × eligible %). If the max OT is blank,
  feasible OT shows Data Required.
- The cost options (transfers, OT, temporary staff, recruitment) show monthly
  cost and cost per covered hour. A missing rate shows **Cost Data Required**,
  never 0. Transfers add no payroll; their one-off orientation cost is optional.

## 8. Aggregation rules

- Only *counted* units are totalled: not archived, and not a relation resolved as EXCLUDE.
- Required FTE totals include only units with a known requirement. The current
  FTE held in Data Required units is reported separately and left out of the
  net gap.
- The totals are marked **provisional** when any of these apply: a Data
  Required unit, an unresolved subset/duplicate relation, or a validation error.
- Reconciliation checks: net gap = surplus − shortage; totals equal the sums of
  the rows; total workforce = RN + PCA + CNC; transfers sent = received;
  recruitment ≤ shortages.

## 9. Seed assumptions to confirm locally

- Minimum 1 RN per shift for every inpatient unit and 1 RN for OPD.
- OPD: 12 h Sat–Thu, Friday closed. OPD clinics = rooms × 70% active × 0.5 (Surgical) or 0.25 (Medical) RN.
- 24/7 schedule for inpatient units, ER and the delivery units.
- The combined Endoscopy/Cathlab current RN (2) is placed on Endoscopy.
- ICU/NICU ventilated and isolation rows, and DR vs Delivery Room–NU, are *Unresolved*.
- Leave 20 h, training 4 h, other 6 h per FTE per month. The overtime limit and costs are blank.

## 10. Implementation notes

- `Calculations.gs` must stay pure (no Apps Script services, no DOM). Keep
  everything inside `NWC_ENGINE_FACTORY_`, because `Code.gs#getEngineSource_`
  serialises it with `Function.prototype.toString()`.
- Do not reference `NwcCalc` at the top level of other files, since the file
  load order is not guaranteed.
- ID, month and day-list columns use the `@` text format, so Sheets does not
  coerce them. Dates found in text cells are converted back to `yyyy-MM`.
- Functions called from menus or `google.script.run` must NOT end in `_`
  (Apps Script makes those private). `tests/gas-compat.test.cjs` enforces this.
- Changing a unit's method goes through `NwcCalc.switchMethod`. It keeps the
  previous method's inputs and copies same-named blank fields (for example beds).
- Web-app access defaults to `MYSELF`, because `DOMAIN` is invalid for
  consumer Gmail accounts. Widen access at deployment time.
- Tests: `tests/engine.test.cjs` (32), `tests/server.test.cjs` (10),
  `tests/gas-compat.test.cjs` (12: private functions, load order, RPC-safe
  values, manifest, scriptlets, storage preservation), and
  `tests/ui-smoke.cjs` (39 browser checks running the real `.gs` files against an
  in-memory sheet mock).
