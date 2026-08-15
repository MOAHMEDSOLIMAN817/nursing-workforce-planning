// Nursing workforce calculation engine.
//
// Business logic only — kept out of React components so it can be unit tested
// and audited. Two staffing models share one FTE/headcount tail:
//
//   INPATIENT / CRITICAL CARE (bed occupancy driven)
//     Occupied Beds          = Beds × Occupancy%
//     Required per Shift      = Occupied Beds ÷ Staffing Ratio   (patients per nurse)
//     Required Hours / Day    = Required per Shift × Coverage Hours/Day   (global)
//     Required Hours / Month  = Required Hours/Day × Working Days/Month    (global)
//
//   CLINIC / AMBULATORY (session driven — NOT 24/7 beds)
//     Required per Shift      = Clinics × Nurses per Clinic
//     Required Hours / Day    = Required per Shift × Operating Hours/Day   (per unit)
//     Required Hours / Month  = Required Hours/Day × Working Days/Month     (per unit)
//
//   SHARED TAIL
//     Base Required FTE       = Required Hours/Month ÷ Available Hours per FTE/Month
//     Required Headcount      = CEILING(Base Required FTE)   (never rounds down)
//     Gap                     = Current FTE − Required Headcount
//
// All arithmetic runs at full precision; only the display layer rounds. Ratios
// and unit-level operating parameters are read from the unit, never hardcoded.

import type { NurseCalc, NurseUnit, NurseUnitModel, NurseUnitType } from '../lib/types';
import { statusFromGap } from './workforceCalculator';

// Global assumptions the inpatient model consumes (clinic model uses per-unit
// operating hours/days but still shares Available Hours per FTE).
export interface NurseAssumptions {
  coverageHoursPerDay: number;
  workingDaysPerMonth: number;
  availableHoursPerFteMonth: number;
}

// Unit types that are staffed as ambulatory/session clinics rather than 24/7 beds.
const CLINIC_TYPES: NurseUnitType[] = [
  'Clinic',
  'Emergency',
  'Operating Room',
  'Procedure Unit',
  'Other',
];

export function modelForType(type: NurseUnitType): NurseUnitModel {
  return CLINIC_TYPES.includes(type) ? 'Clinic' : 'Inpatient';
}

export function calcNurseUnit(unit: NurseUnit, assumptions: NurseAssumptions): NurseCalc {
  const { availableHoursPerFteMonth } = assumptions;

  let occupiedBeds = 0;
  let requiredPerShift = 0;
  let requiredHoursDay = 0;
  let requiredHoursMonth = 0;

  if (unit.model === 'Inpatient') {
    occupiedBeds = unit.beds * (unit.occupancyRate / 100);
    // Guard a zero/invalid ratio so a bad input never yields Infinity/NaN.
    requiredPerShift = unit.staffingRatio > 0 ? occupiedBeds / unit.staffingRatio : 0;
    requiredHoursDay = requiredPerShift * assumptions.coverageHoursPerDay;
    requiredHoursMonth = requiredHoursDay * assumptions.workingDaysPerMonth;
  } else {
    requiredPerShift = unit.clinics * unit.nursesPerClinic;
    requiredHoursDay = requiredPerShift * unit.operatingHoursPerDay;
    requiredHoursMonth = requiredHoursDay * unit.clinicWorkingDays;
  }

  const baseRequiredFte =
    availableHoursPerFteMonth > 0 ? requiredHoursMonth / availableHoursPerFteMonth : 0;
  const requiredHeadcount = Math.ceil(baseRequiredFte);

  const gap = unit.currentFte - requiredHeadcount;

  return {
    model: unit.model,
    occupiedBeds,
    requiredPerShift,
    requiredHoursDay,
    requiredHoursMonth,
    availableHoursPerFte: availableHoursPerFteMonth,
    baseRequiredFte,
    requiredHeadcount,
    currentFte: unit.currentFte,
    gap,
    shortage: gap < 0 ? -gap : 0,
    surplus: gap > 0 ? gap : 0,
    status: statusFromGap(gap),
  };
}

// Grand totals for the Nurses Planning footer and the Executive Overview.
// Percentages and staffing ratios are deliberately never summed.
export interface NurseTotals {
  capacity: number; // beds + clinics across all units
  baseRequiredFte: number; // sum of full-precision FTE
  requiredHeadcount: number; // sum of CEILING headcount
  currentFte: number;
  shortage: number;
  surplus: number;
  unitsWithShortage: number;
}

export function nurseTotals(units: NurseUnit[], rows: NurseCalc[]): NurseTotals {
  return rows.reduce<NurseTotals>(
    (acc, r, i) => {
      const u = units[i];
      return {
        capacity: acc.capacity + (r.model === 'Inpatient' ? u.beds : u.clinics),
        baseRequiredFte: acc.baseRequiredFte + r.baseRequiredFte,
        requiredHeadcount: acc.requiredHeadcount + r.requiredHeadcount,
        currentFte: acc.currentFte + r.currentFte,
        shortage: acc.shortage + r.shortage,
        surplus: acc.surplus + r.surplus,
        unitsWithShortage: acc.unitsWithShortage + (r.status === 'SHORTAGE' ? 1 : 0),
      };
    },
    {
      capacity: 0,
      baseRequiredFte: 0,
      requiredHeadcount: 0,
      currentFte: 0,
      shortage: 0,
      surplus: 0,
      unitsWithShortage: 0,
    },
  );
}
