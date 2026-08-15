import { describe, it, expect } from 'vitest';
import { analyzeGap, buildRoster, rosterTotals, topShortages, type RosterAssumptions } from './workforceRoster';
import type { NurseUnit, PhysicianUnit } from '../lib/types';

const assumptions: RosterAssumptions = {
  coverageHoursPerDay: 24,
  workingDaysPerMonth: 30,
  availableHoursPerFteMonth: 192,
};

describe('analyzeGap — specification examples', () => {
  it('Physician PICU: required 5, current 3 → Gap -2, Shortage 2', () => {
    const g = analyzeGap(3, 5);
    expect(g.gap).toBe(-2);
    expect(g.shortage).toBe(2);
    expect(g.status).toBe('SHORTAGE');
  });

  it('Nurse NICU: required 67, current 58 → Gap -9, Shortage 9', () => {
    const g = analyzeGap(58, 67);
    expect(g.gap).toBe(-9);
    expect(g.shortage).toBe(9);
    expect(g.status).toBe('SHORTAGE');
  });

  it('Balanced: required 23, current 23 → Gap 0', () => {
    const g = analyzeGap(23, 23);
    expect(g.gap).toBe(0);
    expect(g.status).toBe('BALANCED');
  });

  it('Surplus: required 23, current 27 → Gap +4, Surplus 4', () => {
    const g = analyzeGap(27, 23);
    expect(g.gap).toBe(4);
    expect(g.surplus).toBe(4);
    expect(g.status).toBe('SURPLUS');
  });

  it('supports fractional Current FTE', () => {
    const g = analyzeGap(12.5, 5);
    expect(g.gap).toBeCloseTo(7.5, 10);
    expect(g.status).toBe('SURPLUS');
  });
});

function physician(partial: Partial<PhysicianUnit>): PhysicianUnit {
  return { id: 'p', unit: 'PICU', beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 0, ...partial };
}
function nurse(partial: Partial<NurseUnit>): NurseUnit {
  return {
    id: 'n',
    unit: 'NICU - NU',
    unitType: 'Critical Care',
    model: 'Inpatient',
    beds: 47,
    occupancyRate: 75,
    staffingRatio: 2,
    clinics: 0,
    nursesPerClinic: 1,
    operatingHoursPerDay: 10,
    clinicWorkingDays: 26,
    currentFte: 0,
    ...partial,
  };
}

describe('buildRoster — joins Current FTE to validated Required Headcount', () => {
  const rows = buildRoster(
    [physician({ id: 'p1', unit: 'PICU', currentFte: 3 })],
    [nurse({ id: 'n1', unit: 'NICU - NU', currentFte: 58 })],
    assumptions,
  );

  it('physician PICU row keeps required 5 and shows Shortage 2', () => {
    const r = rows.find((x) => x.workforceType === 'Physician' && x.unit === 'PICU')!;
    expect(r.requiredHeadcount).toBe(5);
    expect(r.currentFte).toBe(3);
    expect(r.gap).toBe(-2);
    expect(r.shortage).toBe(2);
    expect(r.status).toBe('SHORTAGE');
    expect(r.department).toBe('Physicians');
  });

  it('nurse NICU row keeps required 67 and shows Shortage 9', () => {
    const r = rows.find((x) => x.workforceType === 'Nurse' && x.unit === 'NICU - NU')!;
    expect(r.requiredHeadcount).toBe(67);
    expect(r.currentFte).toBe(58);
    expect(r.gap).toBe(-9);
    expect(r.shortage).toBe(9);
    expect(r.status).toBe('SHORTAGE');
    expect(r.department).toBe('Inpatient Nursing');
    expect(r.section).toBe('Critical Care');
  });

  it('classifies a clinic nurse row via its own model', () => {
    const rows2 = buildRoster(
      [],
      [nurse({ id: 'c1', unit: 'ER - NU', unitType: 'Emergency', model: 'Clinic', clinics: 2, nursesPerClinic: 1, currentFte: 3 })],
      assumptions,
    );
    const r = rows2[0];
    expect(r.requiredHeadcount).toBe(3);
    expect(r.status).toBe('BALANCED');
    expect(r.department).toBe('Ambulatory Nursing');
  });
});

describe('rosterTotals & topShortages', () => {
  const rows = buildRoster(
    [physician({ id: 'p1', unit: 'PICU', currentFte: 3 })], // req 5, short 2
    [nurse({ id: 'n1', unit: 'NICU - NU', currentFte: 58 })], // req 67, short 9
    assumptions,
  );
  const t = rosterTotals(rows);

  it('splits totals per workforce', () => {
    expect(t.physician.requiredHeadcount).toBe(5);
    expect(t.physician.shortage).toBe(2);
    expect(t.nurse.requiredHeadcount).toBe(67);
    expect(t.nurse.shortage).toBe(9);
  });

  it('total = physician + nurse with net gap', () => {
    expect(t.total.requiredHeadcount).toBe(72);
    expect(t.total.currentFte).toBe(61);
    expect(t.total.netGap).toBe(-11);
    expect(t.total.unitsWithShortage).toBe(2);
  });

  it('ranks shortages by absolute size (NICU nurses before PICU physicians)', () => {
    const top = topShortages(rows);
    expect(top[0].unit).toBe('NICU - NU');
    expect(top[0].shortage).toBe(9);
    expect(top[1].unit).toBe('PICU');
    expect(top[1].shortage).toBe(2);
  });
});
