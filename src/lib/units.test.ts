import { describe, it, expect } from 'vitest';
import {
  appliesToNurses,
  appliesToPhysicians,
  coversNurses,
  coversPhysicians,
  departmentToConfig,
  deriveDepartments,
  deriveNurseUnits,
  derivePhysicianUnits,
  nurseUnitToConfig,
  physicianUnitToConfig,
  reconcileNurseUnits,
  reconcilePhysicianUnits,
  toNurseUnit,
  toPhysicianUnit,
} from './units';
import { calcNurseUnit } from '../services/nursingCalculator';
import { calcPhysicianUnit } from '../services/workforceCalculator';
import type { Department, NurseUnit, PhysicianUnit, UnitConfig } from './types';

const assumptions = { coverageHoursPerDay: 24, workingDaysPerMonth: 30, availableHoursPerFteMonth: 192 };

function makeUnit(p: Partial<UnitConfig>): UnitConfig {
  return {
    id: 'u',
    name: 'Unit',
    unitType: 'Clinic',
    model: 'Clinic',
    status: 'Active',
    workforceType: 'Nurses',
    beds: 0,
    occupancyRate: 0,
    clinics: 0,
    nursesPerClinic: 1,
    coverageHours: 12,
    workingDaysPerMonth: 26,
    physicianRatio: 10,
    physicianCurrentFte: 0,
    nurseRatio: 2,
    nurseCurrentFte: 0,
    ...p,
  };
}

describe('applicability', () => {
  it('coverage flags ignore status; applies* require Active', () => {
    const both = makeUnit({ workforceType: 'Both' });
    expect(coversNurses(both)).toBe(true);
    expect(coversPhysicians(both)).toBe(true);
    expect(appliesToNurses(both)).toBe(true);
    expect(appliesToPhysicians(both)).toBe(true);

    const inactive = makeUnit({ workforceType: 'Both', status: 'Inactive' });
    expect(coversNurses(inactive)).toBe(true);
    expect(appliesToNurses(inactive)).toBe(false); // hidden from active planning
    expect(appliesToPhysicians(inactive)).toBe(false);

    const nurseOnly = makeUnit({ workforceType: 'Nurses' });
    expect(appliesToNurses(nurseOnly)).toBe(true);
    expect(appliesToPhysicians(nurseOnly)).toBe(false);
  });
});

describe('converters + adapters preserve the validated calculations', () => {
  it('Physician PICU still requires 5', () => {
    const p: PhysicianUnit = { id: 'p', unit: 'PICU', beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 0 };
    const cfg = physicianUnitToConfig(p);
    expect(cfg.workforceType).toBe('Physicians');
    expect(calcPhysicianUnit(toPhysicianUnit(cfg), assumptions).requiredHeadcount).toBe(5);
  });

  it('Nurse PICU still requires 23 and NICU still requires 67', () => {
    const picu: NurseUnit = {
      id: 'n1', unit: 'PICU - NU', unitType: 'Critical Care', model: 'Inpatient',
      beds: 22, occupancyRate: 55, staffingRatio: 2, clinics: 0, nursesPerClinic: 1,
      operatingHoursPerDay: 10, clinicWorkingDays: 26, currentFte: 0,
    };
    const nicu: NurseUnit = { ...picu, id: 'n2', unit: 'NICU - NU', beds: 47, occupancyRate: 75 };
    expect(calcNurseUnit(toNurseUnit(nurseUnitToConfig(picu)), assumptions).requiredHeadcount).toBe(23);
    expect(calcNurseUnit(toNurseUnit(nurseUnitToConfig(nicu)), assumptions).requiredHeadcount).toBe(67);
  });
});

describe('departmentToConfig — a user-added VIP survives as a unit', () => {
  const vipDept: Department = {
    id: 'd', name: 'VIP', type: 'OPD', defaultNurseRatio: 2, defaultCoverageHours: 12, active: true, opdClass: 'Non-Surgery',
  };
  const cfg = departmentToConfig(vipDept, 'vip-1');
  it('maps OPD/Non-Surgery to a Clinic-model nursing unit with 12h coverage', () => {
    expect(cfg.model).toBe('Clinic');
    expect(cfg.workforceType).toBe('Nurses');
    expect(cfg.coverageHours).toBe(12);
    expect(cfg.status).toBe('Active');
    expect(appliesToNurses(cfg)).toBe(true);
    expect(appliesToPhysicians(cfg)).toBe(false);
  });
});

describe('VIP synchronization scenario (the reported bug)', () => {
  const base: UnitConfig[] = [
    physicianUnitToConfig({ id: 'p-picu', unit: 'PICU', beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 3 }),
    nurseUnitToConfig({
      id: 'n-picu', unit: 'PICU - NU', unitType: 'Critical Care', model: 'Inpatient',
      beds: 22, occupancyRate: 55, staffingRatio: 2, clinics: 0, nursesPerClinic: 1,
      operatingHoursPerDay: 10, clinicWorkingDays: 26, currentFte: 0,
    }),
  ];

  it('adding VIP (Nurse) makes it appear in Nurses + Departments views, NOT Physicians', () => {
    const vip = makeUnit({ id: 'vip', name: 'VIP', workforceType: 'Nurses', model: 'Clinic', coverageHours: 12 });
    const units = [...base, vip];

    expect(deriveNurseUnits(units).some((u) => u.unit === 'VIP')).toBe(true);
    expect(deriveDepartments(units).some((d) => d.name === 'VIP')).toBe(true);
    expect(derivePhysicianUnits(units).some((u) => u.unit === 'VIP')).toBe(false);
  });

  it('changing VIP coverage to Both makes it appear in Physicians too', () => {
    const vip = makeUnit({ id: 'vip', name: 'VIP', workforceType: 'Both', model: 'Clinic', coverageHours: 12 });
    const units = [...base, vip];
    expect(derivePhysicianUnits(units).some((u) => u.unit === 'VIP')).toBe(true);
    expect(deriveNurseUnits(units).some((u) => u.unit === 'VIP')).toBe(true);
  });

  it('deactivating VIP hides it from active planning everywhere', () => {
    const vip = makeUnit({ id: 'vip', name: 'VIP', workforceType: 'Both', status: 'Inactive' });
    const units = [...base, vip];
    expect(derivePhysicianUnits(units).some((u) => u.unit === 'VIP')).toBe(false);
    expect(deriveNurseUnits(units).some((u) => u.unit === 'VIP')).toBe(false);
  });
});

describe('reconcile edits back into the single store', () => {
  const units: UnitConfig[] = [
    makeUnit({ id: 'both', name: 'VIP', workforceType: 'Both', model: 'Inpatient', beds: 10, occupancyRate: 50 }),
    makeUnit({ id: 'nurseOnly', name: 'Ward', workforceType: 'Nurses' }),
  ];

  it('nurse FTE edit updates only the nurse side', () => {
    const nurses = deriveNurseUnits(units).map((n) => (n.id === 'both' ? { ...n, currentFte: 7 } : n));
    const next = reconcileNurseUnits(units, nurses);
    const both = next.find((u) => u.id === 'both')!;
    expect(both.nurseCurrentFte).toBe(7);
    expect(both.physicianCurrentFte).toBe(0); // untouched
    expect(both.workforceType).toBe('Both');
  });

  it('removing a Both unit from the physician list downgrades coverage, keeps nurse data', () => {
    const physicians = derivePhysicianUnits(units).filter((p) => p.id !== 'both');
    const next = reconcilePhysicianUnits(units, physicians);
    const both = next.find((u) => u.id === 'both')!;
    expect(both).toBeDefined();
    expect(both.workforceType).toBe('Nurses'); // downgraded, not deleted
  });

  it('adding a new nurse unit appends it to the store', () => {
    const nurses = [
      ...deriveNurseUnits(units),
      { id: 'new', unit: 'NewWard', unitType: 'Inpatient Ward', model: 'Inpatient', beds: 0, occupancyRate: 0, staffingRatio: 5, clinics: 0, nursesPerClinic: 1, operatingHoursPerDay: 10, clinicWorkingDays: 26, currentFte: 0 } as NurseUnit,
    ];
    const next = reconcileNurseUnits(units, nurses);
    expect(next.some((u) => u.id === 'new' && u.workforceType === 'Nurses')).toBe(true);
  });
});
