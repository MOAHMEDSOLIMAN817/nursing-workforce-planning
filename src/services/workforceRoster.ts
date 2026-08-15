// Unified workforce roster & gap analysis.
//
// This is the single place that joins actual Current FTE to the validated
// Required Headcount produced by the physician and nurse engines. It does NOT
// recompute or duplicate any staffing math — it calls the existing calculators
// and layers the demand → required → current → gap → status view on top.
//
// One source of truth: Current FTE lives on each planning unit (physicianUnits
// / nurseUnits). Every page reads the roster built here, so editing Current FTE
// anywhere updates everywhere.

import type {
  NurseUnit,
  PhysicianUnit,
  StaffingStatus,
  WorkforceType,
} from '../lib/types';
import { calcPhysicianUnit, statusFromGap, type PhysicianAssumptions } from './workforceCalculator';
import { calcNurseUnit, type NurseAssumptions } from './nursingCalculator';

// Physician and nurse engines consume the same three global assumptions.
export type RosterAssumptions = PhysicianAssumptions & NurseAssumptions;

export interface WorkforceRow {
  id: string; // the planning unit id (physician or nurse)
  workforceType: WorkforceType;
  unit: string;
  department: string;
  section: string;
  requiredHeadcount: number; // whole number, straight from the validated engine
  currentFte: number; // may be fractional
  gap: number; // currentFte - requiredHeadcount
  shortage: number;
  surplus: number;
  status: StaffingStatus;
}

// Pure gap classification, exported for direct testing.
export interface GapResult {
  gap: number;
  shortage: number;
  surplus: number;
  status: StaffingStatus;
}

export function analyzeGap(currentFte: number, requiredHeadcount: number): GapResult {
  const gap = currentFte - requiredHeadcount;
  return {
    gap,
    shortage: gap < 0 ? -gap : 0,
    surplus: gap > 0 ? gap : 0,
    status: statusFromGap(gap),
  };
}

export function buildRoster(
  physicianUnits: PhysicianUnit[],
  nurseUnits: NurseUnit[],
  assumptions: RosterAssumptions,
): WorkforceRow[] {
  const physicians: WorkforceRow[] = physicianUnits.map((u) => {
    const c = calcPhysicianUnit(u, assumptions);
    return {
      id: u.id,
      workforceType: 'Physician',
      unit: u.unit,
      department: 'Physicians',
      section: 'Medical Staff',
      requiredHeadcount: c.requiredHeadcount,
      currentFte: c.currentFte,
      gap: c.gap,
      shortage: c.shortage,
      surplus: c.surplus,
      status: c.status,
    };
  });

  const nurses: WorkforceRow[] = nurseUnits.map((u) => {
    const c = calcNurseUnit(u, assumptions);
    return {
      id: u.id,
      workforceType: 'Nurse',
      unit: u.unit,
      department: u.model === 'Inpatient' ? 'Inpatient Nursing' : 'Ambulatory Nursing',
      section: u.unitType,
      requiredHeadcount: c.requiredHeadcount,
      currentFte: c.currentFte,
      gap: c.gap,
      shortage: c.shortage,
      surplus: c.surplus,
      status: c.status,
    };
  });

  return [...physicians, ...nurses];
}

export interface TypeTotals {
  requiredHeadcount: number;
  currentFte: number;
  shortage: number;
  surplus: number;
  unitsWithShortage: number;
}

function sumType(rows: WorkforceRow[]): TypeTotals {
  return rows.reduce<TypeTotals>(
    (acc, r) => ({
      requiredHeadcount: acc.requiredHeadcount + r.requiredHeadcount,
      currentFte: acc.currentFte + r.currentFte,
      shortage: acc.shortage + r.shortage,
      surplus: acc.surplus + r.surplus,
      unitsWithShortage: acc.unitsWithShortage + (r.status === 'SHORTAGE' ? 1 : 0),
    }),
    { requiredHeadcount: 0, currentFte: 0, shortage: 0, surplus: 0, unitsWithShortage: 0 },
  );
}

export interface RosterTotals {
  physician: TypeTotals;
  nurse: TypeTotals;
  total: {
    requiredHeadcount: number;
    currentFte: number;
    netGap: number;
    unitsWithShortage: number;
  };
}

export function rosterTotals(rows: WorkforceRow[]): RosterTotals {
  const physician = sumType(rows.filter((r) => r.workforceType === 'Physician'));
  const nurse = sumType(rows.filter((r) => r.workforceType === 'Nurse'));
  const requiredHeadcount = physician.requiredHeadcount + nurse.requiredHeadcount;
  const currentFte = physician.currentFte + nurse.currentFte;
  return {
    physician,
    nurse,
    total: {
      requiredHeadcount,
      currentFte,
      netGap: currentFte - requiredHeadcount,
      unitsWithShortage: physician.unitsWithShortage + nurse.unitsWithShortage,
    },
  };
}

// Largest shortages first (absolute shortage). Ties keep required headcount as a
// secondary sort so the bigger unit ranks higher.
export function topShortages(rows: WorkforceRow[], limit = 8): WorkforceRow[] {
  return rows
    .filter((r) => r.status === 'SHORTAGE')
    .sort((a, b) => b.shortage - a.shortage || b.requiredHeadcount - a.requiredHeadcount)
    .slice(0, limit);
}
