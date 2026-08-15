// Shared domain types for the Nursing Workforce Planning System.

export type DepartmentType = 'Inpatient' | 'OPD';

// OPD sub-classification used on the Departments setup page.
export type OpdClass = 'Surgery' | 'Non-Surgery' | 'Mixed';

export type StaffingStatus = 'SHORTAGE' | 'BALANCED' | 'SURPLUS';

// Configurable defaults. These MUST feed the calculation logic — never hardcode.
export interface Settings {
  standardMonthlyNurseHours: number; // e.g. 192
  standardWorkingDays: number; // e.g. 30
  surgeryOpdRatio: number; // nurses per clinic, e.g. 1 (1 nurse : 1 clinic)
  nonSurgeryClinicsPerNurse: number; // clinics per nurse, e.g. 5 (1 nurse : 5 clinics)
}

export interface Department {
  id: string;
  name: string;
  type: DepartmentType;
  defaultNurseRatio: number; // patients per nurse (inpatient)
  defaultCoverageHours: number;
  active: boolean;
  opdClass?: OpdClass; // only for OPD
}

// Raw inputs captured from the Workforce Planning form.
export interface InpatientInputs {
  beds: number;
  occupancyRate: number; // percentage 0-100
  nurseRatio: number; // patients per nurse
  coverageHours: number;
  workingDays: number;
}

export interface OpdInputs {
  surgeryClinics: number;
  nonSurgeryClinics: number;
  operatingHours: number;
  workingDays: number;
}

// Detailed breakdown returned by the calculators.
export interface InpatientBreakdown {
  occupiedBeds: number;
  concurrentNurses: number;
  requiredHours: number;
  requiredHc: number;
}

export interface OpdBreakdown {
  surgeryRequirement: number;
  nonSurgeryRequirement: number;
  concurrentNurses: number;
  requiredHours: number;
  requiredHc: number;
}

export interface CalcResult {
  currentHc: number;
  requiredHc: number;
  requiredHours: number;
  gap: number; // currentHc - requiredHc
  shortage: number;
  surplus: number;
  status: StaffingStatus;
}

// A persisted planning record.
export interface PlanningRecord {
  id: string;
  hospital: string;
  department: string;
  departmentType: DepartmentType;
  month: number; // 1-12
  year: number;
  monthlyNurseHours: number;
  inputs: InpatientInputs | OpdInputs;
  currentHc: number;
  requiredHc: number;
  requiredHours: number;
  gap: number;
  status: StaffingStatus;
  calculationDate: string; // ISO date
}
