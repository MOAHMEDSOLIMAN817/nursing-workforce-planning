# Nursing Workforce Planning System

A focused, professional healthcare workforce-planning MVP for nursing staffing.
It calculates required nursing headcount for **Inpatient** and **OPD** departments,
saves plans locally, and presents an executive dashboard, scenario modelling, and
reports.

> Scope is intentionally narrow: headcount, gap, shortage/surplus, and required
> nursing hours only. It does **not** cover overtime, payroll, salary, attendance,
> leave, recruitment workflow, or employee names.

## Tech Stack

- **React 18 + TypeScript**
- **Vite** (dev server & build)
- **Tailwind CSS** (styling / design system)
- **React Router** (navigation)
- **Vitest** (unit tests for the calculation engine)
- **localStorage** for simple, persistent MVP data (no backend required)

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server (http://localhost:5173)
npm run dev

# 3. Run the calculation unit tests
npm test

# 4. Build for production
npm run build

# 5. Preview the production build
npm run preview
```

## Pages

| Page | Purpose |
| --- | --- |
| **Executive Dashboard** | Total current vs required HC, total shortage/surplus, a Current-vs-Required bar chart, and a "Departments Requiring Action" list (shortages only). |
| **Workforce Planning** | The core form. Choose a department type; enter parameters; **Calculate** to see KPI cards + a calculation breakdown; **Save to Plan** to persist. |
| **Scenario Planning** | For inpatient departments — Required HC across 60/70/80/90/100% occupancy plus a custom occupancy scenario. |
| **Departments** | CRUD for departments (name, type, default ratio, default coverage, active/inactive; OPD classification: Surgery / Non-Surgery / Mixed). |
| **Reports** | Nursing Workforce Plan table (Department, Type, Current, Required, Gap, Shortage, Surplus, Status) with filters + TOTAL row + rule-based executive commentary. |
| **Settings** | Configurable defaults consumed by the calculation engine, plus saved planning history. |

## Calculation Logic

All calculation logic lives in [`src/lib/calc.ts`](src/lib/calc.ts), kept fully
separate from the UI and covered by tests in
[`src/lib/calc.test.ts`](src/lib/calc.test.ts). Settings-driven values (monthly
nurse hours, OPD ratios) are **passed in** — never hardcoded inside the engine.

### Inpatient

```
Occupied Beds          = Beds × Occupancy Rate
Concurrent Nurses      = Occupied Beds ÷ Patients per Nurse
Required Nursing Hours = Concurrent Nurses × Coverage Hours/Day × Working Days/Month
Required HC            = CEIL(Required Nursing Hours ÷ Working Hours per Nurse per Month)
Gap                    = Current HC − Required HC
```

**Worked example** — Beds 20, Occupancy 80%, Ratio 1:2, Coverage 24, Days 30,
Monthly Nurse Hours 192, Current HC 22:

```
Occupied Beds = 16 · Concurrent = 8 · Required Hours = 5,760 · Required HC = 30
Gap = −8 → SHORTAGE 8
```

### OPD

```
Surgery Requirement     = Surgery Clinics × Surgery Ratio (1 nurse : 1 clinic)
Non-Surgery Requirement = CEIL(Non-Surgery Clinics ÷ Clinics per Nurse)  (1 nurse : 5 clinics)
Concurrent Nurses       = Surgery Requirement + Non-Surgery Requirement
Required Nursing Hours  = Concurrent Nurses × Operating Hours/Day × Working Days/Month
Required HC             = CEIL(Required Nursing Hours ÷ Working Hours per Nurse per Month)
Gap                     = Current HC − Required HC
```

**Worked example** — Surgery Clinics 8, Non-Surgery Clinics 20, Operating Hours 10,
Working Days 26, Monthly Nurse Hours 192, Current HC 14:

```
Surgery Req = 8 · Non-Surgery Req = 4 · Concurrent = 12 · Required Hours = 3,120 · Required HC = 17
Gap = −3 → SHORTAGE 3
```

### Status

```
Current HC < Required HC → SHORTAGE
Current HC = Required HC → BALANCED
Current HC > Required HC → SURPLUS
```

`Required HC` is always **rounded up**.

## Settings (defaults)

| Setting | Default |
| --- | --- |
| Standard Monthly Nurse Hours | 192 |
| Standard Working Days | 30 |
| Surgery OPD Ratio | 1 nurse : 1 clinic |
| Non-Surgery OPD Ratio | 1 nurse : 5 clinics |

Changing these on the **Settings** page immediately affects new calculations.

## Data Persistence

Departments, settings, and saved planning records are stored in the browser's
`localStorage` (keys prefixed `nwp.`). Data survives page reloads. To reset, clear
the site's local storage.

## Project Structure

```
src/
  components/    Layout, Sidebar, BarChart, shared UI primitives
  lib/           calc.ts (engine), validation.ts, aggregate.ts, types.ts, format.ts
  pages/         Dashboard, WorkforcePlanning, ScenarioPlanning, Departments, Reports, Settings
  store/         AppContext (state) + storage.ts (localStorage)
```

## Design

An executive healthcare interface inspired by the Saudi German Health visual
identity — deep-purple navigation, teal for operational data, red reserved for
shortages, generous white space, rounded cards, and large KPI numbers.
