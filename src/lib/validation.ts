// Input validation for the Workforce Planning form.
// Returns a map of field -> error message. Empty map means valid.

import type { DepartmentType, NurseUnit } from './types';

export interface ValidationInput {
  departmentType: DepartmentType;
  currentHc: number;
  monthlyNurseHours: number;
  // Inpatient
  beds?: number;
  occupancyRate?: number;
  nurseRatio?: number;
  coverageHours?: number;
  workingDays?: number;
  // OPD
  surgeryClinics?: number;
  nonSurgeryClinics?: number;
  operatingHours?: number;
}

export type ValidationErrors = Record<string, string>;

const num = (v: number | undefined): number => (v === undefined || Number.isNaN(v) ? NaN : v);

export function validatePlanning(input: ValidationInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (num(input.currentHc) < 0) errors.currentHc = 'Current headcount cannot be negative.';
  if (!(num(input.monthlyNurseHours) > 0))
    errors.monthlyNurseHours = 'Working hours per nurse must be greater than 0.';

  if (input.departmentType === 'Inpatient') {
    if (num(input.beds) < 0) errors.beds = 'Beds cannot be negative.';
    if (num(input.occupancyRate) < 0) errors.occupancyRate = 'Occupancy cannot be below 0%.';
    if (num(input.occupancyRate) > 100) errors.occupancyRate = 'Occupancy cannot exceed 100%.';
    if (!(num(input.nurseRatio) > 0)) errors.nurseRatio = 'Nurse ratio must be greater than 0.';
    if (num(input.coverageHours) < 0) errors.coverageHours = 'Coverage hours cannot be negative.';
    if (num(input.workingDays) < 0) errors.workingDays = 'Working days cannot be negative.';
  } else {
    if (num(input.surgeryClinics) < 0)
      errors.surgeryClinics = 'Surgery clinics cannot be negative.';
    if (num(input.nonSurgeryClinics) < 0)
      errors.nonSurgeryClinics = 'Non-surgery clinics cannot be negative.';
    if (num(input.operatingHours) < 0)
      errors.operatingHours = 'Operating hours cannot be negative.';
    if (num(input.workingDays) < 0) errors.workingDays = 'Working days cannot be negative.';
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Physician unit validation
// ---------------------------------------------------------------------------

export interface PhysicianUnitInput {
  unit: string;
  beds: number;
  occupancyRate: number;
  staffingRatio: number;
  currentFte: number;
}

export function validatePhysicianUnit(input: PhysicianUnitInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!input.unit || input.unit.trim() === '') errors.unit = 'Unit name is required.';
  if (Number.isNaN(input.beds) || input.beds < 0) errors.beds = 'Beds cannot be negative.';
  if (Number.isNaN(input.occupancyRate) || input.occupancyRate < 0)
    errors.occupancyRate = 'Occupancy cannot be below 0%.';
  else if (input.occupancyRate > 100) errors.occupancyRate = 'Occupancy cannot exceed 100%.';
  if (Number.isNaN(input.staffingRatio) || !(input.staffingRatio > 0))
    errors.staffingRatio = 'Staffing ratio must be greater than 0.';
  if (Number.isNaN(input.currentFte) || input.currentFte < 0)
    errors.currentFte = 'Current FTE cannot be negative.';

  return errors;
}

// ---------------------------------------------------------------------------
// Nurse unit validation (model-aware)
// ---------------------------------------------------------------------------

export function validateNurseUnit(u: NurseUnit): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!u.unit || u.unit.trim() === '') errors.unit = 'Unit name is required.';
  if (Number.isNaN(u.currentFte) || u.currentFte < 0)
    errors.currentFte = 'Current FTE cannot be negative.';

  if (u.model === 'Inpatient') {
    if (Number.isNaN(u.beds) || u.beds < 0) errors.beds = 'Beds cannot be negative.';
    if (Number.isNaN(u.occupancyRate) || u.occupancyRate < 0)
      errors.occupancyRate = 'Occupancy cannot be below 0%.';
    else if (u.occupancyRate > 100) errors.occupancyRate = 'Occupancy cannot exceed 100%.';
    if (Number.isNaN(u.staffingRatio) || !(u.staffingRatio > 0))
      errors.staffingRatio = 'Staffing ratio must be greater than 0.';
  } else {
    if (Number.isNaN(u.clinics) || u.clinics < 0) errors.clinics = 'Clinics cannot be negative.';
    if (Number.isNaN(u.nursesPerClinic) || u.nursesPerClinic < 0)
      errors.nursesPerClinic = 'Nurses per clinic cannot be negative.';
    if (Number.isNaN(u.operatingHoursPerDay) || !(u.operatingHoursPerDay > 0))
      errors.operatingHoursPerDay = 'Operating hours/day must be greater than 0.';
    if (Number.isNaN(u.clinicWorkingDays) || !(u.clinicWorkingDays > 0))
      errors.clinicWorkingDays = 'Working days/month must be greater than 0.';
  }

  return errors;
}
