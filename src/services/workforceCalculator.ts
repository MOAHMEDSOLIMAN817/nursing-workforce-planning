// Physician workforce calculation engine.
//
// Business logic lives here — never inside UI components — so it can be unit
// tested and audited. Every settings-driven value (coverage hours, working
// days, available FTE hours) is passed in by the caller; nothing is hardcoded.
//
// Calculation chain (per unit):
//   Occupied Beds            = Beds × Occupancy%
//   Required per Shift       = Occupied Beds ÷ Staffing Ratio      (patients per physician)
//   Required Hours / Day     = Required per Shift × Coverage Hours/Day
//   Required Hours / Month   = Required Hours/Day × Working Days/Month
//   Base Required FTE        = Required Hours/Month ÷ Available Hours per FTE/Month
//   Required Headcount       = CEILING(Base Required FTE)          (never normal rounding)
//   Gap                      = Current FTE − Required Headcount
//   Status                   = Gap < 0 Shortage · Gap = 0 Balanced · Gap > 0 Surplus

import type { PhysicianCalc, PhysicianUnit, StaffingStatus } from '../lib/types';

// The only global assumptions the physician engine consumes.
export interface PhysicianAssumptions {
  coverageHoursPerDay: number;
  workingDaysPerMonth: number;
  availableHoursPerFteMonth: number;
}

export function determinePhysicianStatus(gap: number): StaffingStatus {
  if (gap < 0) return 'SHORTAGE';
  if (gap > 0) return 'SURPLUS';
  return 'BALANCED';
}

export function calcPhysicianUnit(
  unit: Pick<PhysicianUnit, 'beds' | 'occupancyRate' | 'staffingRatio' | 'currentFte'>,
  assumptions: PhysicianAssumptions,
): PhysicianCalc {
  const { beds, occupancyRate, staffingRatio, currentFte } = unit;
  const { coverageHoursPerDay, workingDaysPerMonth, availableHoursPerFteMonth } = assumptions;

  const occupiedBeds = beds * (occupancyRate / 100);
  // Guard against a zero/invalid ratio or zero available hours so a bad input
  // never produces Infinity/NaN in the table.
  const requiredPerShift = staffingRatio > 0 ? occupiedBeds / staffingRatio : 0;
  const requiredHoursDay = requiredPerShift * coverageHoursPerDay;
  const requiredHoursMonth = requiredHoursDay * workingDaysPerMonth;
  const baseRequiredFte =
    availableHoursPerFteMonth > 0 ? requiredHoursMonth / availableHoursPerFteMonth : 0;
  const requiredHeadcount = Math.ceil(baseRequiredFte);

  const gap = currentFte - requiredHeadcount;
  const status = determinePhysicianStatus(gap);

  return {
    occupiedBeds,
    requiredPerShift,
    requiredHoursDay,
    requiredHoursMonth,
    availableHoursPerFte: availableHoursPerFteMonth,
    baseRequiredFte,
    requiredHeadcount,
    currentFte,
    gap,
    shortage: gap < 0 ? -gap : 0,
    surplus: gap > 0 ? gap : 0,
    status,
  };
}

// Aggregate totals across all physician units for the Executive Overview.
export interface PhysicianTotals {
  requiredHeadcount: number;
  currentFte: number;
  shortage: number;
  surplus: number;
  unitsWithShortage: number;
}

export function physicianTotals(rows: PhysicianCalc[]): PhysicianTotals {
  return rows.reduce<PhysicianTotals>(
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
