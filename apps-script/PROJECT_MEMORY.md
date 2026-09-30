# PROJECT_MEMORY — Nursing Workforce Calculator (Apps Script)

This file records calculation definitions, assumptions, structure and
decisions. Update it whenever the engine changes. The engine version is
**3.0.0** and the data schema version is **4** (Other units default to manual Required FTE; OPD keeps its clinic formula).

## 1. Origin and workbook corrections

The seed data comes from *Nursing Manpower Calculator.xlsx*: unit names, beds,
occupancy, ratios and current RN counts. The workbook's formulas were **not**
copied.

| Workbook problem | Correction |
| --- | --- |
| Recruitment = Required − (RN + PCA/PCT + CNC headcount) | Gaps are calculated per unit. CNC and PCA/PCT count only as allocated, qualified or approved FTE, never as raw headcount. |
| OR sized by beds × occupancy ÷ ratio | Rooms × operating hours × RN roles, plus prep, recovery and emergency time only when not already included. |
| Overtime references drift (`O12*C5`, `O13*C6`…) | One per-unit overtime chain (§7) with one global limit. |
| Rows omitted from totals / hard-coded totals | Every total is a sum of unit results and is covered by reconciliation checks. |
| Relief 1.15 vs 1.5; OPD 24 h vs 12 h | One hours-per-FTE divisor for all units. OPD Medical uses 12 h (flagged for confirmation). |

## 2. Sign convention (changed in v2)

**Gap = required FTE − available credited FTE.** A positive gap is a shortage;
a negative gap is a surplus. The UI always shows a text label as well as the
colour: "▲ Shortage x" (red) or "▼ Surplus x" (green).

## 3. Hours and FTE

- **Available monthly hours per FTE** = weekly hours × calendar days ÷ 7, unless the override is set (e.g. 208 = 48 × 52 ÷ 12).
- **Base Required FTE** = required nursing hours ÷ available monthly hours per FTE.
- **Leave & Absence Coverage is optional (v3).** Settings `applyReliefFactor` (default `false`) and `reliefFactor` (default `1.17`, limits 1.00–1.50):
  - off: Final Required FTE = Base Required FTE
  - on:  Final Required FTE = Base Required FTE × reliefFactor; Coverage addition = Final − Base
  - Legacy records without these keys load as off / 1.17 (`normalizeSettings` + `readSettings_` defaults).
  - A manual override is the FINAL required FTE and is not multiplied again.
- Leave, training and other hours are **reference only** in v3: they are never deducted, and are used only to show a
  suggested factor = available ÷ (available − those hours). Legacy `fteMode` / `reliefUpliftPct` are kept in the sheet
  for data round-trip but ignored and hidden. (v2 deducted 30 h by default, i.e. an automatic ≈ 17% relief.)
- Gap = Final Required FTE − Available FTE (RN + CNC + transfers + approved PCA). "Balanced" within ±0.005.
- Required FTE = Final Required FTE. **Full precision is kept
  throughout; only the UI and the Results sheet round (2 dp for FTE, whole
  numbers for hours).** Establishment = CEIL per unit.
- **Requirement basis** (a Settings choice, global):
  - `AVERAGE`: average-workload FTE (fractional average RN coverage).
  - `WHOLE_SHIFT`: FTE needed to staff whole nurses on every shift. For
    ratio and acuity units this is `shiftRN × open hours`, where shift census =
    the entered census or CEIL(average occupied). ER uses whole RN per period.
    Other methods use CEIL(average concurrent RN) × open hours.

  Both figures are shown in each unit's detail panel, marked with which one
  drives the requirement. A manual override always drives the requirement and
  requires a reason.

## 4. Unit types and methods

| Unit type | Allowed methods |
| --- | --- |
| INPATIENT | RATIO, ACUITY |
| OPD | MANUAL, CLINIC (clinic-based), ACTIVITY (patient-volume-based) |
| OR / ER / DELIVERY / PROCEDURE / CSSD | MANUAL, or OR / ER / DELIVERY / PROCEDURE / CSSD |
| OTHER | MANUAL, POSTS, ACTIVITY |

**MANUAL (default for Other & OPD since schema 3):** the user types Required FTE directly. It is treated as the Base
Required FTE (Final = typed × relief factor only when Leave & Absence Coverage is on). It needs no minimum, schedule or
method inputs; blank = Data Required (never 0); no reason is required (unlike a manual override). Internally it is
expressed as hours (FTE × available hours per FTE) so gap, overtime and totals use the same chain as every method.
Simple view shows Other & OPD as one table: Unit | Beds / Clinics | Required FTE | Nurses now | Gap | Status (no panels or lists).
- **Beds / Clinics** (`capacityPath`): for MANUAL units it is `params.MANUAL.capacity`, a reference size only (it never
  changes the typed Required FTE); for CLINIC units it is the clinic count that drives the formula.
- **OPD – Surgical / OPD – Medical keep the clinic formula** (schema 4): Required = MAX(clinics × active % × RN per
  clinic, minimum) × opening hours ÷ hours per FTE (× relief factor if on). Shown read-only with the formula
  (e.g. 70 × 70% × 0.5 RN); changing the clinics recalculates. Active % and RN per clinic are edited in Full view.
Typing a number on a unit that uses a calculated method switches it to MANUAL; its previous inputs stay in params.

- Inputs are stored per method (`params[METHOD]`). `switchMethod` never
  copies or reinterprets another method's inputs; switching back restores them.
- A method not allowed for the unit type is a validation error, which blocks saving.
- Method formulas are unchanged from v1:
  - RATIO: MAX(occupied ÷ ratio, minimum) × open hours
  - ACUITY: mutually exclusive groups
  - OR: rooms × roles × hours (+ prep, recovery, emergency)
  - ER: MAX(volume × minutes, period minimum) for each period
  - DELIVERY (v3): minimum RN × open hours **+** deliveries × RN h per delivery **+** other assessments (additive;
    v2 used MAX(workload, minimum)). Example: 3 × 24 × 30 + 5 × 5 = 2185 h → 2185 ÷ 208 = 10.50 FTE; × 1.17 = 12.29 FTE.
  - PROCEDURE, CLINIC, ACTIVITY and POSTS: MAX(workload, minimum) — unchanged
  - CSSD: RN posts; technicians reported separately
- Missing inputs give **Data Required** (null, never 0).

## 5. Credited FTE and gaps (per unit, before aggregation)

```
CNC credit   = Σ allocated FTE × direct-care % (after admin)      — qualified rows only
PCA credit   = MIN( Σ allocated FTE × substitution %, required × pcaMaxSharePct% )  — approved rows only
RN credited  = current RN FTE + CNC credit + transfers in − transfers out
RN coverage gap      = required − RN credited
Adjusted planning gap = RN coverage gap − PCA credit     (the "Remaining gap")
```

- Allocation rows (`Contributions` sheet) hold: category (CNC or PCA), an
  optional employee or group ref, unit, allocated FTE, contribution % (blank =
  the Settings default: CNC 25%, PCA/PCT 25%), qualified/approved, and
  "already in RN FTE".
- A row is credited only when it is approved, has an active unit and FTE > 0,
  and is **not** already counted in current RN FTE.
- Blocking validation errors:
  - Σ allocated FTE exceeds the FTE available (CNC 35 / PCA 54 by default;
    blank = headcount).
  - The same category + unit + ref appears twice (duplicate allocation).
  - One named employee exceeds 1.0 FTE across units.
  - FTE is greater than headcount.
  - The number of named employees exceeds headcount.
- Unallocated capacity is never credited.
- A PCA/PCT is never treated as a qualified RN. PCA/PCT credit reduces only the
  adjusted gap. Unit status (Coverage Met/Gap) uses the RN coverage gap.
- The adjusted gap is labelled **Planning scenario** until Settings
  `pcaAssumptionsApproved = YES`.
- Headcount is reported separately from credited FTE. Total headcount = RN + CNC + PCA/PCT.

## 6. Aggregation

- Totals sum per-unit **positive** gaps (shortage) and **negative** gaps
  (surplus) separately, so one unit's surplus never offsets another's shortage.
  Only a confirmed compatible transfer moves FTE between units.
- Required and available FTE are summed over **exactly the same completed
  units**. Data Required units are excluded from both sides, and their current
  FTE is reported separately. Incomplete totals are labelled
  **"Completed units only — provisional"**.
- The waterfall is the sum of per-unit shortages after each credit:
  - gross (RN only) → − CNC → − transfers → RN coverage shortage → − PCA/PCT → final planning shortage
- Transfers are valid only when all of these hold:
  - competency and coverage compatibility are confirmed
  - both units are counted and have a known requirement
  - FTE ≤ the source's remaining RN FTE
  - FTE ≤ the source's qualified spare (RN + CNC − required, so PCA credit
    cannot free RNs)
  - rows are evaluated in order, cumulatively

## 7. Estimated overtime required (per unit, recalculated on every change)

```
productive h per FTE      = available h per FTE ÷ (reliefFactor if coverage on, else 1)
required hours            = coverage hours for the selected basis (override: FTE × productive h)
available qualified hours = RN credited FTE × productive h per FTE   (RN + CNC + confirmed transfers)
uncovered hours           = MAX(required − [PCA hours if approved model removes them] − available, 0)
OT capacity               = eligible RN headcount × max OT hours per RN (default 48, configurable)
feasible OT               = MIN(uncovered, capacity)
remaining uncovered       = MAX(uncovered − feasible, 0)
remaining recruitment FTE = remaining uncovered ÷ productive h per FTE
estimated OT cost         = feasible × hourly rate, or "Rate Required"
```

- **Eligibility is never assumed.** The global eligibility % is blank by
  default. A unit override (eligible headcount) takes precedence. With no
  eligibility, feasible OT, remaining hours, recruitment and cost show **Data
  Required**, except when uncovered hours = 0 (then everything is 0).
- Equivalent form: uncovered = MAX(Final Required FTE − credited FTE, 0) × productive hours. The relief factor is
  never counted as hours someone must work: Final FTE × productive hours = required hours.
- PCA/PCT hours are subtracted only when `pcaReducesRNWorkload = YES`.
- These are labelled "Estimated overtime required", not actual overtime worked
  or payroll payable.

## 8. Storage (Google Sheets)

| Sheet | Key | Notes |
| --- | --- | --- |
| `Settings` | `key` | One row per setting. Missing keys are added on setup; existing values are never changed. |
| `Units` | `unit_id` | Includes `unit_type` (v2). Method inputs are in `params_json` as `{METHOD: {...}}`. |
| `Transfers` | `transfer_id` | |
| `Contributions` | `allocation_id` | v2 CNC/PCA allocations. |
| `CNC_Contributions` | — | v1 only. Read once by the migration, then left untouched. |
| `Results`, `Audit_Log`, `_Meta` | — | Results are derived output. `_Meta` holds seeded, revision, schema_version. |

**Migration v1 → v2** runs automatically from `initializeSystem()` or on the
first `getAppData()` when `schema_version < 2`:
- It fills a blank `unit_type` from the method.
- If `Contributions` is empty, it converts each v1 CNC hours row:
  - allocated FTE = total hours ÷ hours per FTE (capped at 1)
  - % = direct-care hours ÷ total hours
  - approved = qualified
- No saved inputs are overwritten.
- Existing installs keep their saved overtime max (v1 default was blank). The
  48 h default applies only when the key is new.

## 9. Seed assumptions to confirm locally

- Minimum 1 RN per shift for inpatient units and 1 RN for OPD.
- OPD open 12 h Sat–Thu, Friday closed.
- The combined Endoscopy/Cathlab current RN (2) is on Endoscopy.
- ICU/NICU sub-rows and DR vs Delivery Room–NU are Unresolved.
- Leave & absence coverage off; factor 1.17 when switched on. Reference leave 20, training 4, other 6 h (suggested factor ≈ 1.17).
- CNC direct-care default 25%. PCA/PCT substitution default 25%, capped at 20% of unit required FTE.
- Overtime max 48 h; eligibility not set.
- No allocations are seeded: unit-level CNC/PCA data is required before any credit applies.

## 10. Implementation notes

- **UI modes:** Simple (default) and Full. The choice is stored in `localStorage` as `nwcMode`; if storage is unavailable the
  app falls back to Simple. Simple mode only changes which renderers run (`render*Simple`). Bindings, engine and
  storage are identical, so edits in either view are the same data.

- `Calculations.gs` is pure and everything lives inside `NWC_ENGINE_FACTORY_`,
  which is serialised into the page.
- Functions called from menus or `google.script.run` must not end in `_`.
- Web-app access defaults to `MYSELF`.
- **Migration v3 → v4** (`migrateToV4_`): `restoreClinicFormula` returns OPD units with complete clinic inputs to CLINIC
  (their typed manual number stays in params); blank `MANUAL.capacity` values are filled from `getWorkbookCapacity_()`
  (DR-NU 5, DR 5, OR 4, ER 25, Endoscopy 5, Anesthesia 5). Never overwrites a value the user entered. Runs once.
- **Migration v2 → v3** (`migrateToV3_` → `NwcCalc.convertOtherToManual`): each non-inpatient unit except CLINIC switches to MANUAL,
  prefilled with its current Base Required FTE rounded to 2 dp (blank if Data Required, closed or overridden). Runs once;
  new installs run it right after seeding. Old method inputs are kept, so Full view can switch a unit back.
- Tests:
  - `engine.test.cjs` (52, incl. relief-factor, manual, beds / clinics and clinic-formula cases)
  - `server.test.cjs` (16, including save/reload persistence, v1→v4 / v2→v3 / v3→v4 migrations and legacy settings)
  - `gas-compat.test.cjs` (12)
  - `ui-smoke.cjs` (112 browser checks)
