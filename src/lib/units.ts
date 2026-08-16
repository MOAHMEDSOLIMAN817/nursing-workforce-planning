// Central unit model helpers — the glue between the single `UnitConfig` store
// and the existing (validated, untouched) physician/nurse calculation engines.
//
// The calc engines still consume PhysicianUnit / NurseUnit exactly as before;
// here we (a) convert seed/legacy data into UnitConfig, (b) adapt a UnitConfig
// into the engine input shapes, and (c) derive/reconcile the per-workforce
// views so every module reads from one source. All functions are pure and
// unit-tested.

import type {
  Department,
  NurseUnit,
  PhysicianUnit,
  UnitConfig,
  WorkforceCoverage,
} from './types';

// ---- applicability -------------------------------------------------------

export function appliesToPhysicians(u: UnitConfig): boolean {
  return u.workforceType !== 'Nurses' && u.status === 'Active';
}
export function appliesToNurses(u: UnitConfig): boolean {
  return u.workforceType !== 'Physicians' && u.status === 'Active';
}
// Status-independent applicability (for master listings / inactive filters).
export function coversPhysicians(u: UnitConfig): boolean {
  return u.workforceType !== 'Nurses';
}
export function coversNurses(u: UnitConfig): boolean {
  return u.workforceType !== 'Physicians';
}

// ---- UnitConfig -> engine input shapes -----------------------------------

export function toPhysicianUnit(u: UnitConfig): PhysicianUnit {
  return {
    id: u.id,
    unit: u.name,
    beds: u.beds,
    occupancyRate: u.occupancyRate,
    staffingRatio: u.physicianRatio,
    currentFte: u.physicianCurrentFte,
  };
}

export function toNurseUnit(u: UnitConfig): NurseUnit {
  return {
    id: u.id,
    unit: u.name,
    unitType: u.unitType,
    model: u.model,
    beds: u.beds,
    occupancyRate: u.occupancyRate,
    staffingRatio: u.nurseRatio,
    clinics: u.clinics,
    nursesPerClinic: u.nursesPerClinic,
    // For clinics the coverage hours ARE the operating hours/day; inpatient
    // ignores this and uses the global assumption.
    operatingHoursPerDay: u.coverageHours,
    clinicWorkingDays: u.workingDaysPerMonth,
    currentFte: u.nurseCurrentFte,
  };
}

// ---- seed / legacy -> UnitConfig -----------------------------------------

export function nurseUnitToConfig(n: NurseUnit): UnitConfig {
  return {
    id: n.id,
    name: n.unit,
    unitType: n.unitType,
    model: n.model,
    status: 'Active',
    workforceType: 'Nurses',
    beds: n.beds,
    occupancyRate: n.occupancyRate,
    clinics: n.clinics,
    nursesPerClinic: n.nursesPerClinic,
    coverageHours: n.model === 'Clinic' ? n.operatingHoursPerDay : 24,
    workingDaysPerMonth: n.clinicWorkingDays,
    physicianRatio: 10,
    physicianCurrentFte: 0,
    nurseRatio: n.staffingRatio,
    nurseCurrentFte: n.currentFte,
  };
}

export function physicianUnitToConfig(p: PhysicianUnit): UnitConfig {
  return {
    id: p.id,
    name: p.unit,
    unitType: 'Critical Care',
    model: 'Inpatient',
    status: 'Active',
    workforceType: 'Physicians',
    beds: p.beds,
    occupancyRate: p.occupancyRate,
    clinics: 0,
    nursesPerClinic: 1,
    coverageHours: 24,
    workingDaysPerMonth: 26,
    physicianRatio: p.staffingRatio,
    physicianCurrentFte: p.currentFte,
    nurseRatio: 2,
    nurseCurrentFte: 0,
  };
}

// Legacy Department (e.g. a user-added "VIP") -> UnitConfig. Nurse-facing by
// default, since the old Departments page was nurse-oriented.
export function departmentToConfig(d: Department, id: string): UnitConfig {
  const isOpd = d.type === 'OPD';
  return {
    id,
    name: d.name,
    unitType: isOpd ? (d.opdClass === 'Surgery' ? 'Operating Room' : 'Clinic') : 'Inpatient Ward',
    model: isOpd ? 'Clinic' : 'Inpatient',
    status: d.active ? 'Active' : 'Inactive',
    workforceType: 'Nurses',
    beds: 0,
    occupancyRate: 0,
    clinics: 0,
    nursesPerClinic: 1,
    coverageHours: d.defaultCoverageHours || (isOpd ? 12 : 24),
    workingDaysPerMonth: 26,
    physicianRatio: 10,
    physicianCurrentFte: 0,
    nurseRatio: d.defaultNurseRatio || 2,
    nurseCurrentFte: 0,
  };
}

// ---- derived per-workforce views (Active + applicable only) --------------

export function derivePhysicianUnits(units: UnitConfig[]): PhysicianUnit[] {
  return units.filter(appliesToPhysicians).map(toPhysicianUnit);
}
export function deriveNurseUnits(units: UnitConfig[]): NurseUnit[] {
  return units.filter(appliesToNurses).map(toNurseUnit);
}

// Backwards-compatible Department[] view for the legacy Nurse Calculator and
// Scenario pages, so they keep working off the same single source.
export function deriveDepartments(units: UnitConfig[]): Department[] {
  return units.filter(coversNurses).map((u) => ({
    id: u.id,
    name: u.name,
    type: u.model === 'Clinic' ? 'OPD' : 'Inpatient',
    defaultNurseRatio: u.nurseRatio,
    defaultCoverageHours: u.coverageHours,
    active: u.status === 'Active',
    opdClass: 'Mixed',
  }));
}

// ---- reconcile edited per-workforce views back into the central store ----
//
// The planning pages still call setPhysicianUnits / setNurseUnits with a full
// array. These pure reconcilers fold those edits back onto UnitConfig without
// disturbing the OTHER workforce's data. Removing a "Both" unit from one
// workforce downgrades its coverage instead of deleting shared data.

export function reconcilePhysicianUnits(units: UnitConfig[], next: PhysicianUnit[]): UnitConfig[] {
  const nextById = new Map(next.map((p) => [p.id, p]));
  const prevIds = new Set(units.map((u) => u.id));
  const result: UnitConfig[] = [];

  for (const u of units) {
    if (!appliesToPhysicians(u)) {
      result.push(u); // untouched (nurse-only or inactive)
      continue;
    }
    const p = nextById.get(u.id);
    if (p) {
      result.push({
        ...u,
        name: p.unit,
        beds: p.beds,
        occupancyRate: p.occupancyRate,
        physicianRatio: p.staffingRatio,
        physicianCurrentFte: p.currentFte,
      });
    } else if (coversNurses(u)) {
      // Removed from the physician list but still a nursing unit → keep nurse data.
      result.push({ ...u, workforceType: 'Nurses' });
    }
    // else: physicians-only unit removed → drop it
  }

  for (const p of next) {
    if (!prevIds.has(p.id)) result.push(physicianUnitToConfig(p));
  }
  return result;
}

export function reconcileNurseUnits(units: UnitConfig[], next: NurseUnit[]): UnitConfig[] {
  const nextById = new Map(next.map((n) => [n.id, n]));
  const prevIds = new Set(units.map((u) => u.id));
  const result: UnitConfig[] = [];

  for (const u of units) {
    if (!appliesToNurses(u)) {
      result.push(u);
      continue;
    }
    const n = nextById.get(u.id);
    if (n) {
      result.push({
        ...u,
        name: n.unit,
        unitType: n.unitType,
        model: n.model,
        beds: n.beds,
        occupancyRate: n.occupancyRate,
        nurseRatio: n.staffingRatio,
        clinics: n.clinics,
        nursesPerClinic: n.nursesPerClinic,
        coverageHours: n.operatingHoursPerDay,
        workingDaysPerMonth: n.clinicWorkingDays,
        nurseCurrentFte: n.currentFte,
      });
    } else if (coversPhysicians(u)) {
      result.push({ ...u, workforceType: 'Physicians' });
    }
  }

  for (const n of next) {
    if (!prevIds.has(n.id)) result.push(nurseUnitToConfig(n));
  }
  return result;
}

// Convenience for the coverage <-> boolean flags used in the master form.
export function coverageFromFlags(nurses: boolean, physicians: boolean): WorkforceCoverage {
  if (nurses && physicians) return 'Both';
  return physicians ? 'Physicians' : 'Nurses';
}
