import { describe, it, expect } from 'vitest';
import { calcNurseUnit, modelForType, nurseTotals, type NurseAssumptions } from './nursingCalculator';
import type { NurseUnit } from '../lib/types';

const assumptions: NurseAssumptions = {
  coverageHoursPerDay: 24,
  workingDaysPerMonth: 30,
  availableHoursPerFteMonth: 192,
};

function inpatient(partial: Partial<NurseUnit>): NurseUnit {
  return {
    id: 't',
    unit: 'X',
    unitType: 'Critical Care',
    model: 'Inpatient',
    beds: 0,
    occupancyRate: 0,
    staffingRatio: 2,
    clinics: 0,
    nursesPerClinic: 1,
    operatingHoursPerDay: 10,
    clinicWorkingDays: 26,
    currentFte: 0,
    ...partial,
  };
}

function clinic(partial: Partial<NurseUnit>): NurseUnit {
  return inpatient({ unitType: 'Clinic', model: 'Clinic', ...partial });
}

describe('PICU nursing — specification example', () => {
  const c = calcNurseUnit(inpatient({ beds: 22, occupancyRate: 55, staffingRatio: 2 }), assumptions);
  it('Occupied Beds = 12.1', () => expect(c.occupiedBeds).toBeCloseTo(12.1, 10));
  it('Required Nurses / Shift = 6.05', () => expect(c.requiredPerShift).toBeCloseTo(6.05, 10));
  it('Required Hours / Day = 145.2', () => expect(c.requiredHoursDay).toBeCloseTo(145.2, 10));
  it('Required Hours / Month = 4356', () => expect(c.requiredHoursMonth).toBeCloseTo(4356, 10));
  it('Base Required FTE = 22.6875', () => expect(c.baseRequiredFte).toBeCloseTo(22.6875, 10));
  it('Required Headcount = 23 (CEILING)', () => expect(c.requiredHeadcount).toBe(23));
});

describe('NICU nursing — specification example (no silent round-down)', () => {
  const c = calcNurseUnit(inpatient({ beds: 47, occupancyRate: 75, staffingRatio: 2 }), assumptions);
  it('Occupied Beds = 35.25', () => expect(c.occupiedBeds).toBeCloseTo(35.25, 10));
  it('Required Nurses / Shift = 17.625', () => expect(c.requiredPerShift).toBeCloseTo(17.625, 10));
  it('Required Hours / Day = 423', () => expect(c.requiredHoursDay).toBeCloseTo(423, 10));
  it('Required Hours / Month = 12690', () => expect(c.requiredHoursMonth).toBeCloseTo(12690, 10));
  it('Base Required FTE = 66.09375 (NOT 66)', () => expect(c.baseRequiredFte).toBeCloseTo(66.09375, 10));
  it('Required Headcount = 67', () => expect(c.requiredHeadcount).toBe(67));
});

describe('Intermediate Care — full internal precision (not Excel-rounded 21)', () => {
  const c = calcNurseUnit(inpatient({ beds: 24, occupancyRate: 88, staffingRatio: 3 }), assumptions);
  it('Occupied Beds = 21.12 (not 21)', () => expect(c.occupiedBeds).toBeCloseTo(21.12, 10));
  it('Required Nurses / Shift = 7.04 (not 7)', () => expect(c.requiredPerShift).toBeCloseTo(7.04, 10));
  it('Base Required FTE uses 21.12, not 21', () => {
    // 21.12/3=7.04 ; ×24=168.96 ; ×30=5068.8 ; /192=26.4 ; ceil 27
    expect(c.requiredHoursMonth).toBeCloseTo(5068.8, 10);
    expect(c.baseRequiredFte).toBeCloseTo(26.4, 10);
    expect(c.requiredHeadcount).toBe(27);
  });
});

describe('1st Floor NS1 — ward, precision preserved through the chain', () => {
  const c = calcNurseUnit(inpatient({ unitType: 'Inpatient Ward', beds: 21, occupancyRate: 38, staffingRatio: 5 }), assumptions);
  it('Occupied Beds = 7.98 (not 8)', () => expect(c.occupiedBeds).toBeCloseTo(7.98, 10));
  it('Required Nurses / Shift = 1.596 (uses 7.98, not 8)', () => expect(c.requiredPerShift).toBeCloseTo(1.596, 10));
  it('does not round 7.98 up before dividing', () => {
    // 1.596×24=38.304 ; ×30=1149.12 ; /192=5.985 ; ceil 6
    expect(c.baseRequiredFte).toBeCloseTo(5.985, 10);
    expect(c.requiredHeadcount).toBe(6);
  });
});

describe('Clinic model — session driven, not 24/7 beds', () => {
  const c = calcNurseUnit(
    clinic({ clinics: 2, nursesPerClinic: 1, operatingHoursPerDay: 10, clinicWorkingDays: 26 }),
    assumptions,
  );
  it('Required per Shift = 2 (clinics × nurses/clinic)', () => expect(c.requiredPerShift).toBe(2));
  it('Hours / Day = 20', () => expect(c.requiredHoursDay).toBe(20));
  it('Hours / Month = 520', () => expect(c.requiredHoursMonth).toBe(520));
  it('Base FTE = 2.7083', () => expect(c.baseRequiredFte).toBeCloseTo(2.7083333, 5));
  it('Required Headcount = 3', () => expect(c.requiredHeadcount).toBe(3));
  it('has no occupied beds', () => expect(c.occupiedBeds).toBe(0));
});

describe('gap / status & robustness', () => {
  it('SHORTAGE 3 when current 20 vs required 23', () => {
    const c = calcNurseUnit(inpatient({ beds: 22, occupancyRate: 55, staffingRatio: 2, currentFte: 20 }), assumptions);
    expect(c.gap).toBe(-3);
    expect(c.shortage).toBe(3);
    expect(c.status).toBe('SHORTAGE');
  });
  it('BALANCED when equal', () => {
    const c = calcNurseUnit(inpatient({ beds: 22, occupancyRate: 55, staffingRatio: 2, currentFte: 23 }), assumptions);
    expect(c.status).toBe('BALANCED');
  });
  it('SURPLUS 4 when current 27 vs required 23', () => {
    const c = calcNurseUnit(inpatient({ beds: 22, occupancyRate: 55, staffingRatio: 2, currentFte: 27 }), assumptions);
    expect(c.surplus).toBe(4);
    expect(c.status).toBe('SURPLUS');
  });
  it('zero ratio never yields Infinity/NaN', () => {
    const c = calcNurseUnit(inpatient({ beds: 10, occupancyRate: 80, staffingRatio: 0 }), assumptions);
    expect(Number.isFinite(c.requiredPerShift)).toBe(true);
    expect(c.requiredHeadcount).toBe(0);
  });
});

describe('modelForType mapping', () => {
  it('bed-based types are Inpatient', () => {
    expect(modelForType('Critical Care')).toBe('Inpatient');
    expect(modelForType('Inpatient Ward')).toBe('Inpatient');
    expect(modelForType('Delivery Room')).toBe('Inpatient');
  });
  it('ambulatory types are Clinic', () => {
    expect(modelForType('Clinic')).toBe('Clinic');
    expect(modelForType('Emergency')).toBe('Clinic');
    expect(modelForType('Operating Room')).toBe('Clinic');
    expect(modelForType('Procedure Unit')).toBe('Clinic');
    expect(modelForType('Other')).toBe('Clinic');
  });
});

describe('nurseTotals — never sums ratios or percentages', () => {
  const units = [
    inpatient({ beds: 22, occupancyRate: 55, staffingRatio: 2, currentFte: 20 }),
    clinic({ clinics: 2, nursesPerClinic: 1, currentFte: 1 }),
  ];
  const rows = units.map((u) => calcNurseUnit(u, assumptions));
  const t = nurseTotals(units, rows);
  it('capacity = beds + clinics', () => expect(t.capacity).toBe(24));
  it('required headcount = 23 + 3', () => expect(t.requiredHeadcount).toBe(26));
  it('current = 21', () => expect(t.currentFte).toBe(21));
  it('base FTE is full precision sum', () => expect(t.baseRequiredFte).toBeCloseTo(22.6875 + 2.7083333, 4));
});
