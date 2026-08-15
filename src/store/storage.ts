// Simple persistent store backed by localStorage. Appropriate for an MVP —
// no backend required, data survives reloads.

import type { Department, PhysicianUnit, PlanningRecord, Settings } from '../lib/types';
import { uid } from '../lib/format';

const KEYS = {
  settings: 'nwp.settings.v1',
  departments: 'nwp.departments.v1',
  records: 'nwp.records.v1',
  physicianUnits: 'nwp.physicianUnits.v1',
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
