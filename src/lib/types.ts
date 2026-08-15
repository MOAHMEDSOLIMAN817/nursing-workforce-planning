// Shared domain types for the Nursing Workforce Planning System.

export type DepartmentType = 'Inpatient' | 'OPD';

// OPD sub-classification used on the Departments setup page.
export type OpdClass = 'Surgery' | 'Non-Surgery' | 'Mixed';

export type StaffingStatus = 'SHORTAGE' | 'BALANCED' | 'SURPLUS';

// The two clinical workforces the planner tracks.
export type WorkforceType = 'Physician' | 'Nurse';

// Explicit (non-fuzzy) mapping from an external / actual source unit name to a
// planning unit. Each source name maps to exactly one planning unit so a given
// Current FTE record can never be counted against two units.
export interface UnitMapping {
  id: string;
  sourceName: string;
  workforceType: WorkforceType;
  planningUnitId: string; // id of a PhysicianUnit or NurseUnit
}

// Configurable defaults. These MUST feed the calculation logic — never hardcode.
export interface Settings {
  // --- Global workforce assumptions (shared by all planning modules) ---
  workingDaysPerMonth: number; // e.g. 30
  coverageHoursPerDay: number; // e.g. 24 (hours the unit must be covered each day)
  shiftLength: number; // e.g. 12 (hours per shift)
  availableHoursPerFteMonth: number; // e.g. 192 (productive hours one FTE delivers per month)
  reliefFactorPct: number; // e.g. 20 (percentage uplift for leave/relief — reserved for later phases)
  minStaffPerShift: number; // e.g. 1 (minimum staff that must be on any covered shift)

  // --- Nursing-specific ratios (existing engine — kept for backward compatibility) ---
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

// ---------------------------------------------------------------------------
// Nurses Workforce Planning
// ---------------------------------------------------------------------------

// Which staffing formula a nursing unit uses. Inpatient units are driven by bed
// occupancy; clinic/ambulatory units are driven by clinics × nurses × hours.
export type NurseUnitModel = 'Inpatient' | 'Clinic';

export type NurseUnitType =
  | 'Critical Care'
  | 'Inpatient Ward'
  | 'Clinic'
  | 'Emergency'
  | 'Operating Room'
  | 'Procedure Unit'
  | 'Delivery Room'
  | 'Other';

// Editable inputs captured per nursing unit. Only the fields relevant to the
// unit's model are used by the calculator; the rest are ignored (but kept so
// switching model back and forth preserves data).
export interface NurseUnit {
  id: string;
  unit: string;
  unitType: NurseUnitType;
  model: NurseUnitModel;
  // Inpatient model
  beds: number;
  occupancyRate: number; // percentage 0-100
  staffingRatio: number; // patients per nurse (e.g. 2 => 1 nurse : 2 patients)
  // Clinic model
  clinics: number;
  nursesPerClinic: number;
  operatingHoursPerDay: number; // clinic operating hours per day (e.g. 10)
  clinicWorkingDays: number; // clinic working days per month (e.g. 26)
  // Common
  currentFte: number; // actual nurses on staff — never seeded, entered by the user
}

// Fully calculated row for a nursing unit (all values read-only in the UI).
export interface NurseCalc {
  model: NurseUnitModel;
  occupiedBeds: number; // inpatient only (0 for clinic)
  requiredPerShift: number; // concurrent nurses
  requiredHoursDay: number;
  requiredHoursMonth: number;
  availableHoursPerFte: number;
  baseRequiredFte: number;
  requiredHeadcount: number;
  currentFte: number;
  gap: number; // currentFte - requiredHeadcount
  shortage: number;
  surplus: number;
  status: StaffingStatus;
}

// ---------------------------------------------------------------------------
// Physicians Workforce Planning
// ---------------------------------------------------------------------------

// Editable inputs captured per clinical unit on the Physicians Planning page.
export interface PhysicianUnit {
  id: string;
  unit: string;
  beds: number;
  occupancyRate: number; // percentage 0-100
  staffingRatio: number; // patients per physician (e.g. 10 => 1 physician : 10 patients)
  currentFte: number; // actual physicians on staff — never seeded, entered by the user
}

// Fully calculated row for a physician unit (all values read-only in the UI).
export interface PhysicianCalc {
  occupiedBeds: number;
  requiredPerShift: number;
  requiredHoursDay: number;
  requiredHoursMonth: number;
  availableHoursPerFte: number;
  baseRequiredFte: number;
  requiredHeadcount: number;
  currentFte: number;
  gap: number; // currentFte - requiredHeadcount
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
