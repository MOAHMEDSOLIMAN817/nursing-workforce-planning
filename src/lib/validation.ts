// Input validation for the Workforce Planning form.
// Returns a map of field -> error message. Empty map means valid.

import type { DepartmentType } from './types';

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
