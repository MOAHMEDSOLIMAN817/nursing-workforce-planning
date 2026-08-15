// Pure calculation logic for nursing workforce planning.
// Kept completely separate from the UI so it can be unit-tested.
// Settings-driven values (monthly nurse hours, OPD ratios) are always passed in
// by the caller — nothing is hardcoded here.

import type {
  CalcResult,
  InpatientBreakdown,
  InpatientInputs,
  OpdBreakdown,
  OpdInputs,
  Settings,
  StaffingStatus,
} from './types';

export function determineStatus(currentHc: number, requiredHc: number): StaffingStatus {
  if (currentHc < requiredHc) return 'SHORTAGE';
  if (currentHc > requiredHc) return 'SURPLUS';
  return 'BALANCED';
}

function buildResult(
  currentHc: number,
  requiredHc: number,
  requiredHours: number,
): CalcResult {
  const gap = currentHc - requiredHc;
  const status = determineStatus(currentHc, requiredHc);
  return {
    currentHc,
    requiredHc,
    requiredHours,
    gap,
    shortage: gap < 0 ? -gap : 0,
    surplus: gap > 0 ? gap : 0,
    status,
  };
}

/**
 * Inpatient staffing calculation.
 *
 *   Occupied Beds            = Beds × Occupancy Rate
 *   Concurrent Nurses        = Occupied Beds ÷ Patients per Nurse
 *   Required Nursing Hours   = Concurrent Nurses × Coverage Hours/Day × Working Days/Month
 *   Required HC              = CEIL(Required Nursing Hours ÷ Working Hours per Nurse per Month)
 */
export function calcInpatient(
  inputs: InpatientInputs,
  currentHc: number,
  monthlyNurseHours: number,
): { breakdown: InpatientBreakdown; result: CalcResult } {
  const occupiedBeds = inputs.beds * (inputs.occupancyRate / 100);
  const concurrentNurses = occupiedBeds / inputs.nurseRatio;
  const requiredHours = concurrentNurses * inputs.coverageHours * inputs.workingDays;
  const requiredHc = Math.ceil(requiredHours / monthlyNurseHours);

  const breakdown: InpatientBreakdown = {
    occupiedBeds,
    concurrentNurses,
    requiredHours,
    requiredHc,
  };

  return { breakdown, result: buildResult(currentHc, requiredHc, requiredHours) };
}

/**
 * OPD staffing calculation.
 *
 *   Surgery Requirement      = Surgery Clinics × Surgery Ratio (nurses per clinic)
 *   Non-Surgery Requirement  = CEIL(Non-Surgery Clinics ÷ Clinics per Nurse)
 *   Concurrent Nurses        = Surgery Requirement + Non-Surgery Requirement
 *   Required Nursing Hours   = Concurrent Nurses × Operating Hours/Day × Working Days/Month
 *   Required HC              = CEIL(Required Nursing Hours ÷ Working Hours per Nurse per Month)
 */
export function calcOpd(
  inputs: OpdInputs,
  currentHc: number,
  monthlyNurseHours: number,
  settings: Pick<Settings, 'surgeryOpdRatio' | 'nonSurgeryClinicsPerNurse'>,
): { breakdown: OpdBreakdown; result: CalcResult } {
  const surgeryRequirement = inputs.surgeryClinics * settings.surgeryOpdRatio;
  const nonSurgeryRequirement = Math.ceil(
    inputs.nonSurgeryClinics / settings.nonSurgeryClinicsPerNurse,
  );
  const concurrentNurses = surgeryRequirement + nonSurgeryRequirement;
  const requiredHours = concurrentNurses * inputs.operatingHours * inputs.workingDays;
  const requiredHc = Math.ceil(requiredHours / monthlyNurseHours);

  const breakdown: OpdBreakdown = {
    surgeryRequirement,
    nonSurgeryRequirement,
    concurrentNurses,
    requiredHours,
    requiredHc,
  };

  return { breakdown, result: buildResult(currentHc, requiredHc, requiredHours) };
}

// Executive commentary using simple deterministic rules (no AI).
export function buildCommentary(
  departmentName: string,
  status: StaffingStatus,
  shortage: number,
  surplus: number,
): string {
  switch (status) {
    case 'SHORTAGE':
      return `${departmentName} requires ${shortage} additional ${
        shortage === 1 ? 'nurse' : 'nurses'
      } to meet the calculated staffing requirement.`;
    case 'SURPLUS':
      return `${departmentName} has a surplus of ${surplus} ${
        surplus === 1 ? 'nurse' : 'nurses'
      } compared with the calculated requirement.`;
    default:
      return 'Current nursing staffing is aligned with the calculated requirement.';
  }
}
