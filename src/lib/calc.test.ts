import { describe, it, expect } from 'vitest';
import { calcInpatient, calcOpd, determineStatus, buildCommentary } from './calc';
import { validatePlanning } from './validation';

const settings = {
  surgeryOpdRatio: 1,
  nonSurgeryClinicsPerNurse: 5,
};

describe('Inpatient calculation', () => {
  it('matches the specification worked example', () => {
    const { breakdown, result } = calcInpatient(
      { beds: 20, occupancyRate: 80, nurseRatio: 2, coverageHours: 24, workingDays: 30 },
      22,
      192,
    );
    expect(breakdown.occupiedBeds).toBe(16);
    expect(breakdown.concurrentNurses).toBe(8);
    expect(breakdown.requiredHours).toBe(5760);
    expect(breakdown.requiredHc).toBe(30);
    expect(result.gap).toBe(-8);
    expect(result.shortage).toBe(8);
    expect(result.surplus).toBe(0);
    expect(result.status).toBe('SHORTAGE');
  });

  it('rounds Required HC up', () => {
    // 10 beds, 55% occ -> 5.5 occupied, ratio 2 -> 2.75 concurrent
    // hours = 2.75 * 12 * 30 = 990 ; 990/192 = 5.15 -> ceil 6
    const { breakdown } = calcInpatient(
      { beds: 10, occupancyRate: 55, nurseRatio: 2, coverageHours: 12, workingDays: 30 },
      6,
      192,
    );
    expect(breakdown.requiredHours).toBe(990);
    expect(breakdown.requiredHc).toBe(6);
  });

  it('reports SURPLUS and BALANCED correctly', () => {
    const surplus = calcInpatient(
      { beds: 20, occupancyRate: 80, nurseRatio: 2, coverageHours: 24, workingDays: 30 },
      35,
      192,
    );
    expect(surplus.result.status).toBe('SURPLUS');
    expect(surplus.result.surplus).toBe(5);

    const balanced = calcInpatient(
      { beds: 20, occupancyRate: 80, nurseRatio: 2, coverageHours: 24, workingDays: 30 },
      30,
      192,
    );
    expect(balanced.result.status).toBe('BALANCED');
    expect(balanced.result.gap).toBe(0);
  });
});

describe('OPD calculation', () => {
  it('matches the specification worked example', () => {
    const { breakdown, result } = calcOpd(
      { surgeryClinics: 8, nonSurgeryClinics: 20, operatingHours: 10, workingDays: 26 },
      14,
      192,
      settings,
    );
    expect(breakdown.surgeryRequirement).toBe(8);
    expect(breakdown.nonSurgeryRequirement).toBe(4);
    expect(breakdown.concurrentNurses).toBe(12);
    expect(breakdown.requiredHours).toBe(3120);
    expect(breakdown.requiredHc).toBe(17);
    expect(result.gap).toBe(-3);
    expect(result.shortage).toBe(3);
    expect(result.status).toBe('SHORTAGE');
  });

  it('rounds non-surgery requirement up (22 clinics -> 5 nurses)', () => {
    const { breakdown } = calcOpd(
      { surgeryClinics: 0, nonSurgeryClinics: 22, operatingHours: 10, workingDays: 26 },
      0,
      192,
      settings,
    );
    expect(breakdown.nonSurgeryRequirement).toBe(5);
  });

  it('honours settings-driven ratios', () => {
    const { breakdown } = calcOpd(
      { surgeryClinics: 4, nonSurgeryClinics: 10, operatingHours: 8, workingDays: 26 },
      0,
      192,
      { surgeryOpdRatio: 2, nonSurgeryClinicsPerNurse: 4 },
    );
    expect(breakdown.surgeryRequirement).toBe(8); // 4 * 2
    expect(breakdown.nonSurgeryRequirement).toBe(3); // ceil(10/4)
  });
});

describe('determineStatus', () => {
  it('classifies edges', () => {
    expect(determineStatus(5, 10)).toBe('SHORTAGE');
    expect(determineStatus(10, 10)).toBe('BALANCED');
    expect(determineStatus(12, 10)).toBe('SURPLUS');
  });
});

describe('commentary', () => {
  it('produces short deterministic sentences', () => {
    expect(buildCommentary('ICU', 'SHORTAGE', 8, 0)).toBe(
      'ICU requires 8 additional nurses to meet the calculated staffing requirement.',
    );
    expect(buildCommentary('CCU', 'SURPLUS', 0, 2)).toBe(
      'CCU has a surplus of 2 nurses compared with the calculated requirement.',
    );
    expect(buildCommentary('Ward', 'BALANCED', 0, 0)).toBe(
      'Current nursing staffing is aligned with the calculated requirement.',
    );
    expect(buildCommentary('ICU', 'SHORTAGE', 1, 0)).toContain('1 additional nurse ');
  });
});

describe('validation', () => {
  it('flags out-of-range inpatient inputs', () => {
    const errors = validatePlanning({
      departmentType: 'Inpatient',
      currentHc: -1,
      monthlyNurseHours: 0,
      beds: -5,
      occupancyRate: 120,
      nurseRatio: 0,
      coverageHours: -1,
      workingDays: -2,
    });
    expect(errors.currentHc).toBeTruthy();
    expect(errors.monthlyNurseHours).toBeTruthy();
    expect(errors.beds).toBeTruthy();
    expect(errors.occupancyRate).toBeTruthy();
    expect(errors.nurseRatio).toBeTruthy();
    expect(errors.coverageHours).toBeTruthy();
    expect(errors.workingDays).toBeTruthy();
  });

  it('passes a valid inpatient payload', () => {
    const errors = validatePlanning({
      departmentType: 'Inpatient',
      currentHc: 22,
      monthlyNurseHours: 192,
      beds: 20,
      occupancyRate: 80,
      nurseRatio: 2,
      coverageHours: 24,
      workingDays: 30,
    });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('flags negative OPD clinics', () => {
    const errors = validatePlanning({
      departmentType: 'OPD',
      currentHc: 0,
      monthlyNurseHours: 192,
      surgeryClinics: -1,
      nonSurgeryClinics: -3,
      operatingHours: 10,
      workingDays: 26,
    });
    expect(errors.surgeryClinics).toBeTruthy();
    expect(errors.nonSurgeryClinics).toBeTruthy();
  });
});
