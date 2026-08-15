import { describe, it, expect } from 'vitest';
import {
  calcPhysicianUnit,
  determinePhysicianStatus,
  physicianTotals,
  type PhysicianAssumptions,
} from './workforceCalculator';

const assumptions: PhysicianAssumptions = {
  coverageHoursPerDay: 24,
  workingDaysPerMonth: 30,
  availableHoursPerFteMonth: 192,
};

describe('Physician calculation — PICU specification example', () => {
  const calc = calcPhysicianUnit(
    { beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 0 },
    assumptions,
  );

  it('Occupied Beds = 12.1', () => {
    expect(calc.occupiedBeds).toBeCloseTo(12.1, 10);
  });
  it('Required Physicians / Shift = 1.21', () => {
    expect(calc.requiredPerShift).toBeCloseTo(1.21, 10);
  });
  it('Required Hours / Day = 29.04', () => {
    expect(calc.requiredHoursDay).toBeCloseTo(29.04, 10);
  });
  it('Required Hours / Month = 871.2', () => {
    expect(calc.requiredHoursMonth).toBeCloseTo(871.2, 10);
  });
  it('Base Required FTE = 4.5375', () => {
    expect(calc.baseRequiredFte).toBeCloseTo(4.5375, 10);
  });
  it('Required Headcount = 5 (CEILING, not rounding)', () => {
    expect(calc.requiredHeadcount).toBe(5);
  });
});

describe('Physician gap & status', () => {
  it('reports Shortage when Current FTE < Required Headcount', () => {
    const calc = calcPhysicianUnit(
      { beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 3 },
      assumptions,
    );
    expect(calc.requiredHeadcount).toBe(5);
    expect(calc.gap).toBe(-2);
    expect(calc.shortage).toBe(2);
    expect(calc.surplus).toBe(0);
    expect(calc.status).toBe('SHORTAGE');
  });

  it('reports Balanced when equal', () => {
    const calc = calcPhysicianUnit(
      { beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 5 },
      assumptions,
    );
    expect(calc.gap).toBe(0);
    expect(calc.status).toBe('BALANCED');
  });

  it('reports Surplus when Current FTE > Required Headcount', () => {
    const calc = calcPhysicianUnit(
      { beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 8 },
      assumptions,
    );
    expect(calc.gap).toBe(3);
    expect(calc.surplus).toBe(3);
    expect(calc.status).toBe('SURPLUS');
  });
});

describe('Physician engine — robustness & settings-driven behaviour', () => {
  it('uses the supplied Available Hours per FTE (no hardcoded 192)', () => {
    const calc = calcPhysicianUnit(
      { beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 0 },
      { ...assumptions, availableHoursPerFteMonth: 160 },
    );
    // 871.2 / 160 = 5.445 -> ceil 6
    expect(calc.baseRequiredFte).toBeCloseTo(5.445, 10);
    expect(calc.requiredHeadcount).toBe(6);
  });

  it('never yields Infinity/NaN on a zero ratio', () => {
    const calc = calcPhysicianUnit(
      { beds: 10, occupancyRate: 80, staffingRatio: 0, currentFte: 0 },
      assumptions,
    );
    expect(Number.isFinite(calc.requiredPerShift)).toBe(true);
    expect(calc.requiredHeadcount).toBe(0);
  });

  it('empty unit (0 beds) requires 0 headcount', () => {
    const calc = calcPhysicianUnit(
      { beds: 0, occupancyRate: 0, staffingRatio: 10, currentFte: 0 },
      assumptions,
    );
    expect(calc.requiredHeadcount).toBe(0);
    expect(calc.status).toBe('BALANCED');
  });
});

describe('determinePhysicianStatus', () => {
  it('classifies edges', () => {
    expect(determinePhysicianStatus(-1)).toBe('SHORTAGE');
    expect(determinePhysicianStatus(0)).toBe('BALANCED');
    expect(determinePhysicianStatus(1)).toBe('SURPLUS');
  });
});

describe('physicianTotals', () => {
  it('aggregates required, current, shortage, surplus and shortage-unit count', () => {
    const rows = [
      calcPhysicianUnit({ beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 3 }, assumptions), // req 5, short 2
      calcPhysicianUnit({ beds: 22, occupancyRate: 55, staffingRatio: 10, currentFte: 8 }, assumptions), // req 5, surplus 3
    ];
    const t = physicianTotals(rows);
    expect(t.requiredHeadcount).toBe(10);
    expect(t.currentFte).toBe(11);
    expect(t.shortage).toBe(2);
    expect(t.surplus).toBe(3);
    expect(t.unitsWithShortage).toBe(1);
  });
});
