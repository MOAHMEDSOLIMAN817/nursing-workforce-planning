// Simple persistent store backed by localStorage. Appropriate for an MVP —
// no backend required, data survives reloads.

import type {
  Department,
  NurseUnit,
  NurseUnitType,
  PhysicianUnit,
  PlanningRecord,
  Settings,
  UnitConfig,
  UnitMapping,
} from '../lib/types';
import { uid } from '../lib/format';
import { departmentToConfig, nurseUnitToConfig, physicianUnitToConfig } from '../lib/units';

const KEYS = {
  settings: 'nwp.settings.v1',
  departments: 'nwp.departments.v1',
  records: 'nwp.records.v1',
  physicianUnits: 'nwp.physicianUnits.v1',
  nurseUnits: 'nwp.nurseUnits.v1',
  unitMappings: 'nwp.unitMappings.v1',
  units: 'nwp.units.v1',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  // Global workforce assumptions
  workingDaysPerMonth: 30,
  coverageHoursPerDay: 24,
  shiftLength: 12,
  availableHoursPerFteMonth: 192,
  reliefFactorPct: 20,
  minStaffPerShift: 1,
  // Nursing engine (existing)
  standardMonthlyNurseHours: 192,
  standardWorkingDays: 30,
  surgeryOpdRatio: 1,
  nonSurgeryClinicsPerNurse: 5,
};

export const DEFAULT_HOSPITAL = 'Saudi German Hospital – Riyadh';

// Seed departments so the dashboard/reports have data on first run.
export const SEED_DEPARTMENTS: Department[] = [
  { id: uid(), name: 'ICU', type: 'Inpatient', defaultNurseRatio: 2, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'CCU', type: 'Inpatient', defaultNurseRatio: 2, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'NICU', type: 'Inpatient', defaultNurseRatio: 2, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'PICU', type: 'Inpatient', defaultNurseRatio: 2, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'Medical Ward', type: 'Inpatient', defaultNurseRatio: 5, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'Surgical Ward', type: 'Inpatient', defaultNurseRatio: 5, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'Pediatric Ward', type: 'Inpatient', defaultNurseRatio: 4, defaultCoverageHours: 24, active: true },
  { id: uid(), name: 'Outpatient Clinics', type: 'OPD', defaultNurseRatio: 0, defaultCoverageHours: 10, active: true, opdClass: 'Mixed' },
];

// Physician demo units. Current FTE is intentionally 0 for every unit — the
// hospital enters real staffing later. PICU carries the specification's worked
// example (22 beds, 55% occupancy, 1 physician : 10 patients) so the engine can
// be validated on first load. Every other unit starts blank (beds/occupancy 0)
// with a sensible non-zero default ratio so the field stays valid.
const PHYS_UNIT_NAMES = [
  'PICU',
  'NICU',
  'NICU ISO',
  'ICU FF',
  'ICUG',
  'IMC',
  'CCU',
  'Stroke Unit',
  '1st Floor NS1',
  '2nd Floor NS1',
  '2nd Floor NS2',
  '3rd Floor NS1',
  '3rd Floor NS2',
  '3rd Floor NS3',
  'Delivery Room',
];

export const SEED_PHYSICIAN_UNITS: PhysicianUnit[] = PHYS_UNIT_NAMES.map((name) =>
  name === 'PICU'
    ? { id: uid(), unit: 'PICU', beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 0 }
    : { id: uid(), unit: name, beds: 0, occupancyRate: 0, staffingRatio: 10, currentFte: 0 },
);

// Nursing demo units. Current FTE is 0 for every unit — the hospital enters
// real staffing later (and Excel import will follow). Each unit carries its own
// configurable staffing ratio; ratios are never hardcoded in the calculator.
// PICU / NICU / Intermediate Care / 1st Floor NS1 seed the specification's
// worked examples so the engine can be validated on first load.
type InpatientSeed = [name: string, type: NurseUnitType, ratio: number, beds: number, occ: number];
type ClinicSeed = [name: string, type: NurseUnitType];

const INPATIENT_SEEDS: InpatientSeed[] = [
  ['PICU - NU', 'Critical Care', 2, 22, 55],
  ['NICU - NU', 'Critical Care', 2, 47, 75],
  ['NICU ISO - NU', 'Critical Care', 2, 0, 0],
  ['ICU - NU', 'Critical Care', 2, 0, 0],
  ['ICUG - NU', 'Critical Care', 2, 0, 0],
  ['Intermediate Care - NU', 'Inpatient Ward', 3, 24, 88],
  ['CCU - NU', 'Critical Care', 2, 0, 0],
  ['Stroke Unit', 'Critical Care', 2, 0, 0],
  ['1st Floor NS1', 'Inpatient Ward', 5, 21, 38],
  ['2nd Floor NS1', 'Inpatient Ward', 5, 0, 0],
  ['2nd Floor NS2', 'Inpatient Ward', 5, 0, 0],
  ['3rd Floor NS1', 'Inpatient Ward', 5, 0, 0],
  ['3rd Floor NS2', 'Inpatient Ward', 5, 0, 0],
  ['3rd Floor NS3', 'Inpatient Ward', 5, 0, 0],
  ['Delivery Room - NU', 'Delivery Room', 2, 0, 0],
];

const CLINIC_SEEDS: ClinicSeed[] = [
  ['Anesthesia - NU', 'Procedure Unit'],
  ['Cardiology - NU', 'Clinic'],
  ['Cath Lab - NU', 'Procedure Unit'],
  ['Dental - NU', 'Clinic'],
  ['Dermatology - NU', 'Clinic'],
  ['Endoscopy - NU', 'Procedure Unit'],
  ['ENT/Otorhinolaryngology - NU', 'Clinic'],
  ['ER - NU', 'Emergency'],
  ['Family Medicine - NU', 'Clinic'],
  ['General Surgery - NU', 'Clinic'],
  ['IMU/LTU', 'Other'],
  ['Internal Medicine - NU', 'Clinic'],
  ['Interventional Radiology - NU', 'Procedure Unit'],
  ['Nephrology and Hemodialysis - NU', 'Procedure Unit'],
  ['Neurology - NU', 'Clinic'],
  ['Neurosurgery - NU', 'Clinic'],
  ['OB & Gyne Clinic - NU', 'Clinic'],
  ['OB/GYN - NU', 'Clinic'],
  ['Oncology - NU', 'Clinic'],
  ['Ophthalmology - NU', 'Clinic'],
  ['OR - NU', 'Operating Room'],
  ['Orthopedics - NU', 'Clinic'],
  ['Outpatient - NU', 'Clinic'],
  ['Pediatrics - NU', 'Clinic'],
  ['Psychiatry - NU', 'Clinic'],
  ['Recovery Room - NU', 'Procedure Unit'],
  ['Urology - NU', 'Clinic'],
];

function baseNurseUnit(): Omit<NurseUnit, 'id' | 'unit' | 'unitType' | 'model'> {
  return {
    beds: 0,
    occupancyRate: 0,
    staffingRatio: 2,
    clinics: 0,
    nursesPerClinic: 1,
    operatingHoursPerDay: 10,
    clinicWorkingDays: 26,
    currentFte: 0,
  };
}

export const SEED_NURSE_UNITS: NurseUnit[] = [
  ...INPATIENT_SEEDS.map(([unit, unitType, staffingRatio, beds, occupancyRate]) => ({
    ...baseNurseUnit(),
    id: uid(),
    unit,
    unitType,
    model: 'Inpatient' as const,
    staffingRatio,
    beds,
    occupancyRate,
  })),
  ...CLINIC_SEEDS.map(([unit, unitType]) => ({
    ...baseNurseUnit(),
    id: uid(),
    unit,
    unitType,
    model: 'Clinic' as const,
  })),
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Settings ----
export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) };
}
export function saveSettings(s: Settings): void {
  write(KEYS.settings, s);
}

// ---- Departments ----
export function loadDepartments(): Department[] {
  const existing = read<Department[] | null>(KEYS.departments, null);
  if (existing && existing.length) return existing;
  write(KEYS.departments, SEED_DEPARTMENTS);
  return SEED_DEPARTMENTS;
}
export function saveDepartments(list: Department[]): void {
  write(KEYS.departments, list);
}

// ---- Planning records ----
export function loadRecords(): PlanningRecord[] {
  return read<PlanningRecord[]>(KEYS.records, []);
}
export function saveRecords(list: PlanningRecord[]): void {
  write(KEYS.records, list);
}

// ---- Physician units ----
export function loadPhysicianUnits(): PhysicianUnit[] {
  const existing = read<PhysicianUnit[] | null>(KEYS.physicianUnits, null);
  if (existing && existing.length) return existing;
  write(KEYS.physicianUnits, SEED_PHYSICIAN_UNITS);
  return SEED_PHYSICIAN_UNITS;
}
export function savePhysicianUnits(list: PhysicianUnit[]): void {
  write(KEYS.physicianUnits, list);
}

// ---- Nurse units ----
export function loadNurseUnits(): NurseUnit[] {
  const existing = read<NurseUnit[] | null>(KEYS.nurseUnits, null);
  if (existing && existing.length) return existing;
  write(KEYS.nurseUnits, SEED_NURSE_UNITS);
  return SEED_NURSE_UNITS;
}
export function saveNurseUnits(list: NurseUnit[]): void {
  write(KEYS.nurseUnits, list);
}

// ---- Unit mappings (source name -> planning unit) ----
export function loadUnitMappings(): UnitMapping[] {
  return read<UnitMapping[]>(KEYS.unitMappings, []);
}
export function saveUnitMappings(list: UnitMapping[]): void {
  write(KEYS.unitMappings, list);
}

// ---- Central units (single source of truth) ------------------------------

// Fresh-install seed: the combined nurse + physician demo units as UnitConfig.
export function buildSeedUnits(): UnitConfig[] {
  return [
    ...SEED_NURSE_UNITS.map(nurseUnitToConfig),
    ...SEED_PHYSICIAN_UNITS.map(physicianUnitToConfig),
  ];
}

// Build the central store once, from whatever data already exists in
// localStorage, WITHOUT wiping anything. Existing physician units, nurse units
// and any user-added department (e.g. "VIP") are preserved with stable IDs.
function migrateToUnits(): UnitConfig[] {
  const oldPhys = read<PhysicianUnit[] | null>(KEYS.physicianUnits, null);
  const oldNurse = read<NurseUnit[] | null>(KEYS.nurseUnits, null);
  const oldDepts = read<Department[] | null>(KEYS.departments, null) ?? [];

  const physSource = oldPhys && oldPhys.length ? oldPhys : SEED_PHYSICIAN_UNITS;
  const nurseSource = oldNurse && oldNurse.length ? oldNurse : SEED_NURSE_UNITS;

  const units: UnitConfig[] = [
    ...nurseSource.map(nurseUnitToConfig),
    ...physSource.map(physicianUnitToConfig),
  ];

  // Import user-added departments that aren't seeds and aren't already units
  // (this is how a manually-added "VIP" survives migration).
  const seedDeptNames = new Set(SEED_DEPARTMENTS.map((d) => d.name.trim().toLowerCase()));
  const taken = new Set(units.map((u) => u.name.trim().toLowerCase()));
  for (const d of oldDepts) {
    const nm = d.name.trim().toLowerCase();
    if (!nm || seedDeptNames.has(nm) || taken.has(nm)) continue;
    units.push(departmentToConfig(d, uid()));
    taken.add(nm);
  }
  return units;
}

export function loadUnits(): UnitConfig[] {
  const existing = read<UnitConfig[] | null>(KEYS.units, null);
  if (existing && existing.length) return existing;
  const migrated = migrateToUnits();
  write(KEYS.units, migrated);
  return migrated;
}

export function saveUnits(list: UnitConfig[]): void {
  write(KEYS.units, list);
}
