'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./gas-mock.cjs');

const E = loadEngine();
const C = E.NwcCalc;
const clone = o => JSON.parse(JSON.stringify(o));
const close = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function baseSettings(over) { return Object.assign(C.defaultSettings(), { reportingMonth: '2026-10' }, over || {}); }
function state(units, over) {
  return Object.assign({ settings: baseSettings(), units, transfers: [], cncContributions: [] }, over || {});
}
function ward(id, over) {
  const u = C.newUnit(id, id, 'INPATIENT', 'RATIO');
  u.params.RATIO = { beds: 20, occupancyPct: 80, patientsPerRN: 4, shiftCensus: '' };
  u.currentRNHeadcount = 20;
  return Object.assign(u, over || {});
}
function unitRes(r, id) { return r.units.find(u => u.id === id); }
function errors(r) { return r.issues.filter(i => i.level === 'error'); }

// October 2026: 31 days, 5 Fridays.
test('calendar: actual days and Fridays for the reporting month', () => {
  const mi = C.monthInfo('2026-10');
  assert.equal(mi.days, 31);
  assert.equal(mi.fridays, 5);
  assert.equal(C.monthInfo('2028-02').days, 29);
  assert.equal(C.monthInfo('bad'), null);
});

test('hours per FTE: leave deducted exactly once (DEDUCT) and ignored in UPLIFT', () => {
  const mi = C.monthInfo('2026-10');
  const d = C.hoursModel(baseSettings(), mi);
  close(d.scheduledHours, 48 * 31 / 7, 1e-9);
  close(d.hoursPerFTE, 48 * 31 / 7 - 30, 1e-9);
  const u = C.hoursModel(baseSettings({ fteMode: 'UPLIFT', reliefUpliftPct: 15 }), mi);
  close(u.hoursPerFTE, 48 * 31 / 7 / 1.15, 1e-9);
  const u2 = C.hoursModel(baseSettings({ fteMode: 'UPLIFT', leaveHours: 100 }), mi);
  assert.equal(u2.hoursPerFTE, u.hoursPerFTE, 'leave has no effect in uplift mode');
  const ov = C.hoursModel(baseSettings({ scheduledHoursOverride: 200 }), mi);
  assert.equal(ov.hoursPerFTE, 170);

  // Required FTE = hours ÷ available — no additional relief factor on top.
  const r = C.calculate(state([ward('W')]));
  const w = unitRes(r, 'W');
  close(w.requiredFTE, C.round2(w.coverageHours / (48 * 31 / 7 - 30)), 1e-9);
  const ru = C.calculate(state([ward('W')], { settings: baseSettings({ fteMode: 'UPLIFT' }) }));
  close(unitRes(ru, 'W').requiredFTE, C.round2(w.coverageHours / (48 * 31 / 7) * 1.15), 1e-9);
});

test('non-positive available hours is a validation error', () => {
  const r = C.calculate(state([ward('W')], { settings: baseSettings({ leaveHours: 300 }) }));
  assert.ok(errors(r).some(e => /Available coverage hours per FTE must be positive/.test(e.message)));
  assert.equal(unitRes(r, 'W').status, C.STATUS.DATA);
});

test('inpatient ratio: MAX(occupied ÷ ratio, minimum) × coverage hours × days', () => {
  const r = C.calculate(state([ward('W')]));
  const w = unitRes(r, 'W');
  assert.equal(w.occupied, 16);
  close(w.coverageHours, 4 * 24 * 31, 1e-9);
  assert.equal(w.establishment, Math.ceil(w.requiredFTE));
  assert.equal(w.shiftRN, 4);
  assert.equal(w.shiftCensusAssumed, true);
});

test('ratio change: halving patients per RN doubles demand above the minimum', () => {
  const a = unitRes(C.calculate(state([ward('W')])), 'W');
  const u = ward('W'); u.params.RATIO.patientsPerRN = 2;
  const b = unitRes(C.calculate(state([u])), 'W');
  close(b.coverageHours, a.coverageHours * 2, 1e-9);
});

test('zero activity: open unit keeps minimum coverage; closed unit generates none', () => {
  const open = ward('O', { minRNPerShift: 2 }); open.params.RATIO.beds = 0;
  const closed = ward('X', { isOpen: false }); closed.params.RATIO.beds = 0;
  const r = C.calculate(state([open, closed]));
  const o = unitRes(r, 'O'), x = unitRes(r, 'X');
  close(o.coverageHours, 2 * 24 * 31, 1e-9);
  assert.ok(o.requiredFTE > 0);
  assert.equal(o.shiftRN, 2);
  assert.equal(x.requiredFTE, 0);
  assert.equal(x.coverageHours, 0);
  assert.equal(x.status, C.STATUS.CLOSED);
  assert.equal(x.surplus, 20, 'staff of a closed unit show as surplus');
});

test('missing workload data → Data Required, never zero demand, totals provisional', () => {
  const or = C.newUnit('OR', 'OR', 'OTHER', 'OR');
  or.params.OR.rooms = 4; or.currentRNHeadcount = 23;
  const r = C.calculate(state([ward('W'), or]));
  const o = unitRes(r, 'OR');
  assert.equal(o.status, C.STATUS.DATA);
  assert.equal(o.requiredFTE, null);
  assert.equal(o.netGap, null);
  assert.ok(o.missing.length > 0);
  assert.equal(r.summary.provisional, true);
  assert.equal(r.summary.requiredRNFTE, unitRes(r, 'W').requiredFTE, 'unknown unit not added as zero');
  assert.equal(r.summary.currentFTEInDataRequiredUnits, 23);
  assert.equal(r.summary.netGapFTE, unitRes(r, 'W').netGap, 'net gap excludes staff of Data Required units');
});

test('manual override requires a reason and shows Manual Override', () => {
  const u = C.newUnit('A', 'Anesthesia', 'OTHER', 'POSTS'); u.currentRNHeadcount = 4;
  u.manualOverrideFTE = 5;
  let r = C.calculate(state([u]));
  assert.ok(errors(r).some(e => /requires a reason/.test(e.message)));
  assert.equal(unitRes(r, 'A').status, C.STATUS.DATA);
  u.manualOverrideReason = 'Theatre data pending; agreed by DON';
  r = C.calculate(state([u]));
  assert.equal(errors(r).length, 0);
  const a = unitRes(r, 'A');
  assert.equal(a.status, C.STATUS.OVERRIDE);
  assert.equal(a.requiredFTE, 5);
  assert.equal(a.netGap, -1);
  close(a.coverageHours, 5 * r.hours.hoursPerFTE, 1e-9);
});

test('acuity mode: mutually exclusive groups with their own ratios', () => {
  const u = C.newUnit('I', 'ICU', 'INPATIENT', 'ACUITY');
  u.params.ACUITY = { beds: 20, groups: [{ name: 'Ventilated', patients: 6, patientsPerRN: 1 }, { name: 'Standard', patients: 10, patientsPerRN: 2 }] };
  let r = C.calculate(state([u]));
  const i = unitRes(r, 'I');
  close(i.avgConcurrentRN, 11, 1e-9);
  assert.equal(i.occupied, 16);
  // Same group twice → overlap error; groups exceeding beds → error.
  u.params.ACUITY.groups.push({ name: 'ventilated', patients: 1, patientsPerRN: 1 });
  r = C.calculate(state([u]));
  assert.ok(errors(r).some(e => /mutually exclusive/.test(e.message)));
  u.params.ACUITY.groups = [{ name: 'A', patients: 15, patientsPerRN: 1 }, { name: 'B', patients: 10, patientsPerRN: 2 }];
  r = C.calculate(state([u]));
  assert.ok(errors(r).some(e => /groups overlap/.test(e.message)));
});

test('subset / duplicate rows: unresolved is provisional; confirmed subset excluded from totals', () => {
  const parent = ward('P'), child = ward('C', { relation: { type: 'SUBSET_OF', unitId: 'P', resolution: 'UNRESOLVED' } });
  let r = C.calculate(state([parent, child]));
  assert.equal(r.summary.provisional, true);
  assert.equal(r.summary.currentRNHC, 40);
  child.relation.resolution = 'EXCLUDE';
  r = C.calculate(state([parent, child]));
  assert.equal(r.summary.currentRNHC, 20);
  assert.equal(r.summary.requiredRNFTE, unitRes(r, 'P').requiredFTE);
  assert.equal(r.summary.provisional, false);
  child.relation.resolution = 'SEPARATE';
  r = C.calculate(state([parent, child]));
  assert.equal(r.summary.currentRNHC, 40);
  assert.equal(r.summary.provisional, false);
});

test('Friday schedule: OPD opening hours use actual Fridays separately', () => {
  const opd = C.newUnit('OPD', 'OPD', 'OTHER', 'CLINIC');
  opd.params.CLINIC = { clinics: 10, utilisationPct: 100, rnPerClinic: 1 };
  opd.minRNPerShift = 1;
  opd.schedule = { weekdayHours: 8, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  const a = unitRes(C.calculate(state([opd])), 'OPD');
  close(a.openHours, 26 * 8, 1e-9); // 31 days − 5 Fridays
  opd.schedule.fridayHours = 4;
  const b = unitRes(C.calculate(state([opd])), 'OPD');
  close(b.coverageHours - a.coverageHours, 10 * 5 * 4, 1e-9);
  // Sun–Thu only (Saturday closed) and a public holiday with reduced hours.
  opd.schedule = { weekdayHours: 8, openDays: 'Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 4 };
  const s = baseSettings({ holidaysInMonth: 1 });
  const c = unitRes(C.calculate(state([opd], { settings: s })), 'OPD');
  const mi = C.monthInfo('2026-10');
  close(c.openHours, (31 - mi.fridays - mi.dayCounts.Sat - 1) * 8 + 4, 1e-9);
});

test('OPD methods are exclusive: switching method never adds both', () => {
  const u = C.newUnit('O', 'OPD', 'OTHER', 'CLINIC');
  u.minRNPerShift = 0;
  u.schedule = { weekdayHours: 10, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  u.params.CLINIC = { clinics: 10, utilisationPct: 50, rnPerClinic: 1 };
  u.params.ACTIVITY = { activitiesPerMonth: 3000, minutesPerActivity: 20, supportHoursPerMonth: 100 };
  const a = unitRes(C.calculate(state([u])), 'O');
  close(a.coverageHours, 5 * 10 * 26, 1e-9);
  u.method = 'ACTIVITY';
  const b = unitRes(C.calculate(state([u])), 'O');
  close(b.coverageHours, 3000 * 20 / 60 + 100, 1e-9);
  u.minRNPerShift = 5; // minimum 5 × 260 h = 1300 h > 1100 h workload
  const c = unitRes(C.calculate(state([u])), 'O');
  close(c.coverageHours, 1300, 1e-9);
});

test('OR uses rooms × operating hours × RN roles, not a bed ratio', () => {
  const u = C.newUnit('OR', 'OR', 'OTHER', 'OR');
  u.minRNPerShift = 1;
  u.schedule = { weekdayHours: 10, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  u.params.OR = { rooms: 4, rnPerRoom: 2, prepMinutesPerRoomDay: 30, prepIncluded: false, recoveryRN: 2, recoveryIncluded: false, emergencyRN: 1, emergencyIncluded: false };
  u.params.RATIO = { beds: 4, occupancyPct: 80, patientsPerRN: 5 }; // workbook-style data is ignored
  const r = unitRes(C.calculate(state([u])), 'OR');
  const open = 26 * 10;
  const expected = 4 * 2 * open + 4 * 0.5 * 26 + 2 * open + 1 * (31 * 24 - open);
  close(r.coverageHours, expected, 1e-9);
  // Items marked "already included" are not added again.
  u.params.OR.prepIncluded = true; u.params.OR.recoveryIncluded = true; u.params.OR.emergencyIncluded = true;
  close(unitRes(C.calculate(state([u])), 'OR').coverageHours, 4 * 2 * open, 1e-9);
});

test('ER uses volume by period and acuity with a per-period minimum', () => {
  const u = C.newUnit('ER', 'ER', 'OTHER', 'ER');
  u.params.ER = {
    periods: [{ name: 'Day', hoursPerDay: 12, minRN: 3 }, { name: 'Night', hoursPerDay: 12, minRN: 2 }],
    workload: [{ period: 'Day', acuity: 'High', casesPerMonth: 300, minutesPerCase: 180 }, { period: 'Day', acuity: 'Low', casesPerMonth: 1500, minutesPerCase: 30 },
      { period: 'Night', acuity: 'High', casesPerMonth: 100, minutesPerCase: 180 }]
  };
  const r = unitRes(C.calculate(state([u])), 'ER');
  const day = Math.max(300 * 3 + 750, 3 * 12 * 31), night = Math.max(300, 2 * 12 * 31);
  close(r.coverageHours, day + night, 1e-9);
  u.params.ER.workload.push({ period: 'Evening', acuity: 'High', casesPerMonth: 1, minutesPerCase: 1 });
  assert.ok(errors(C.calculate(state([u]))).some(e => /unknown period/.test(e.message)));
});

test('Endoscopy and Cathlab are separate procedure units; recovery not double counted', () => {
  const mk = (id, n) => {
    const u = C.newUnit(id, id, 'OTHER', 'PROCEDURE'); u.minRNPerShift = 0;
    u.schedule = { weekdayHours: 8, openDays: 'Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
    u.params.PROCEDURE = { proceduresPerMonth: n, procedureMinutes: 60, rnPerProcedure: 2, prepMinutesPerProcedure: 15, recoveryMinutesPerPatient: 60, patientsPerRecoveryRN: 2, recoveryIncluded: false };
    return u;
  };
  const e = mk('Endo', 200), c = mk('Cath', 100);
  const r = C.calculate(state([e, c]));
  close(unitRes(r, 'Endo').coverageHours, 200 * (120 + 15) / 60 + 200 * 60 / 60 / 2, 1e-9);
  close(unitRes(r, 'Cath').coverageHours, 100 * (120 + 15) / 60 + 100 * 60 / 60 / 2, 1e-9);
  c.params.PROCEDURE.recoveryIncluded = true;
  close(unitRes(C.calculate(state([e, c])), 'Cath').coverageHours, 100 * 135 / 60, 1e-9);
});

test('CSSD: RN posts only; technician workload reported separately', () => {
  const u = C.newUnit('CSSD', 'CSSD', 'OTHER', 'CSSD'); u.minRNPerShift = 1;
  u.schedule = { weekdayHours: 16, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 8, holidayHours: 8 };
  u.params.CSSD = { rnPosts: 1, setsPerMonth: 3000, techMinutesPerSet: 20, currentTechnicians: 6 };
  const r = C.calculate(state([u]));
  const x = unitRes(r, 'CSSD');
  close(x.coverageHours, 1 * (26 * 16 + 5 * 8), 1e-9);
  close(x.technicians.requiredFTE, C.round2(3000 * 20 / 60 / r.hours.hoursPerFTE), 1e-9);
  assert.equal(r.summary.requiredRNFTE, x.requiredFTE, 'technician FTE not in RN totals');
});

test('CNC: partial direct-care contribution only when qualified, assigned and specified', () => {
  const s = state([ward('W')]);
  s.cncContributions = [
    { id: 'c1', cncRef: 'CNC-01', unitId: 'W', qualified: true, totalHours: 180, adminHours: 120, directCareHours: 60 },
    { id: 'c2', cncRef: 'CNC-02', unitId: 'W', qualified: false, totalHours: 180, adminHours: 0, directCareHours: 180 },
    { id: 'c3', cncRef: 'CNC-03', unitId: 'W', qualified: true, totalHours: 180, adminHours: 180, directCareHours: '' }
  ];
  const r = C.calculate(s);
  const w = unitRes(r, 'W');
  close(w.cncFTE, C.round2(60 / r.hours.hoursPerFTE), 1e-9);
  close(w.effectiveFTE, C.round2(20 + w.cncFTE), 1e-9);
  assert.equal(r.cnc.filter(c => c.eligible).length, 1);
  assert.equal(r.summary.currentRNHC, 20, 'CNC does not add RN headcount');
  // Direct + admin > total → error; same CNC credited with more than one FTE across units → error.
  s.cncContributions[0].adminHours = 150;
  assert.ok(errors(C.calculate(s)).some(e => /exceed total hours/.test(e.message)));
  s.cncContributions = [
    { id: 'a', cncRef: 'CNC-09', unitId: 'W', qualified: true, directCareHours: 120 },
    { id: 'b', cncRef: 'CNC-09', unitId: 'W2', qualified: true, directCareHours: 120 }
  ];
  s.units.push(ward('W2'));
  assert.ok(errors(C.calculate(s)).some(e => /duplicate capacity/.test(e.message)));
});

test('PCA/PCT never replaces RN requirement or recruitment', () => {
  const short = ward('S', { currentRNHeadcount: 5 });
  const a = C.calculate(state([short]));
  const b = C.calculate(state([short], { settings: baseSettings({ pcaHeadcount: 500 }) }));
  assert.equal(a.summary.requiredRNFTE, b.summary.requiredRNFTE);
  assert.equal(a.summary.recruitmentFTE, b.summary.recruitmentFTE);
  assert.equal(b.summary.totalWorkforceHC, 5 + 500 + 35);
  assert.ok(b.summary.recruitmentFTE > 0);
});

test('transfers: only confirmed, compatible, non-harmful transfers count', () => {
  const src = ward('SRC', { currentRNHeadcount: 30 }), dst = ward('DST', { currentRNHeadcount: 10 });
  const base = C.calculate(state([src, dst]));
  const spare = unitRes(base, 'SRC').surplus, need = unitRes(base, 'DST').shortage;
  assert.ok(spare > 3 && need > 3);
  const mk = (fte, comp, cov) => ({ id: 't' + Math.random(), sourceUnitId: 'SRC', destUnitId: 'DST', fte, competencyConfirmed: comp, coverageCompatible: cov });

  // Ineligible (competency not confirmed) → not counted, recruitment unchanged.
  let r = C.calculate(state([src, dst], { transfers: [mk(2, false, true)] }));
  assert.equal(r.transfers[0].valid, false);
  assert.equal(r.summary.confirmedTransferFTE, 0);
  assert.equal(r.summary.recruitmentFTE, base.summary.recruitmentFTE);

  // Eligible → counted, recruitment reduced by the same FTE.
  r = C.calculate(state([src, dst], { transfers: [mk(2, true, true)] }));
  assert.equal(r.transfers[0].valid, true);
  close(r.summary.recruitmentFTE, base.summary.recruitmentFTE - 2, 1e-9);
  close(unitRes(r, 'SRC').postGap, unitRes(r, 'SRC').netGap - 2, 1e-9);

  // Would create a shortage in the source → rejected.
  r = C.calculate(state([src, dst], { transfers: [mk(spare + 0.5, true, true)] }));
  assert.equal(r.transfers[0].valid, false);
  assert.ok(r.transfers[0].reasons.some(x => /shortage in the source/.test(x)));

  // Cumulative: second transfer rejected once spare is used up.
  r = C.calculate(state([src, dst], { transfers: [mk(spare - 1, true, true), mk(2, true, true)] }));
  assert.equal(r.transfers.map(t => t.valid).join(','), 'true,false');
  assert.ok(r.summary.recruitmentFTE >= 0);
  assert.ok(r.checks.every(c => c.ok), JSON.stringify(r.checks.filter(c => !c.ok)));
});

test('transfers from a Data Required unit are rejected', () => {
  const or = C.newUnit('OR', 'OR', 'OTHER', 'OR'); or.currentRNHeadcount = 23;
  const dst = ward('DST', { currentRNHeadcount: 5 });
  const r = C.calculate(state([or, dst], { transfers: [{ id: 't', sourceUnitId: 'OR', destUnitId: 'DST', fte: 3, competencyConfirmed: true, coverageCompatible: true }] }));
  assert.equal(r.transfers[0].valid, false);
  assert.ok(r.transfers[0].reasons.some(x => /Data Required/.test(x)));
});

test('overtime: uncovered hours separate from feasible overtime, capped by eligible staff and limit', () => {
  const u = ward('W', { currentRNHeadcount: 10 }); // short
  let r = C.calculate(state([u]));
  let w = unitRes(r, 'W');
  close(w.uncoveredHours, w.coverageHours - 10 * r.hours.hoursPerFTE, 1e-6);
  assert.equal(w.feasibleOT, null, 'no limit entered → Data Required');
  assert.equal(r.summary.feasibleOTHours, null);

  r = C.calculate(state([u], { settings: baseSettings({ otMaxHoursPerRN: 10 }) }));
  w = unitRes(r, 'W');
  assert.equal(w.otCapacity, 100);
  assert.equal(w.feasibleOT, Math.min(w.uncoveredHours, 100));
  close(w.uncoveredAfterOT, w.uncoveredHours - w.feasibleOT, 1e-9);
  assert.ok(w.uncoveredAfterOT > 0, 'overtime does not solve every shortage');

  u.otEligibleHeadcount = 3;
  r = C.calculate(state([u], { settings: baseSettings({ otMaxHoursPerRN: 10 }) }));
  assert.equal(unitRes(r, 'W').otCapacity, 30);
  r = C.calculate(state([u], { settings: baseSettings({ otMaxHoursPerRN: 10, otEligiblePct: 50 }) }));
  assert.equal(unitRes(r, 'W').otCapacity, 30, 'unit-level eligible headcount overrides the % default');
});

test('costs: missing rates show Cost Data Required (null), not zero', () => {
  const r = C.calculate(state([ward('W', { currentRNHeadcount: 10 })]));
  const byName = n => r.costs.options.find(o => o.option.startsWith(n));
  assert.equal(byName('Recruitment').monthlyCost, null);
  assert.equal(byName('Temporary').monthlyCost, null);
  assert.equal(byName('Overtime').monthlyCost, null);
  const r2 = C.calculate(state([ward('W', { currentRNHeadcount: 10 })], { settings: baseSettings({ costRNMonthly: 20000, costTempPerHour: 150, otMaxHoursPerRN: 20, costOTPerHour: 120 }) }));
  const o2 = n => r2.costs.options.find(o => o.option.startsWith(n));
  close(o2('Recruitment').monthlyCost, r2.summary.recruitmentFTE * 20000, 1e-6);
  close(o2('Temporary').monthlyCost, r2.summary.uncoveredHours * 150, 1e-6);
  close(o2('Overtime').monthlyCost, r2.summary.feasibleOTHours * 120, 1e-6);
});

test('validation: ranges, positivity, negatives, duplicates, ER hours', () => {
  const bad = ward('B'); bad.params.RATIO.occupancyPct = 120;
  const zero = ward('Z'); zero.params.RATIO.patientsPerRN = 0;
  const neg = ward('N', { currentRNHeadcount: -1 });
  const dup1 = ward('D1', { name: 'Ward A' }), dup2 = ward('D2', { name: 'ward  a' });
  const er = C.newUnit('ER', 'ER', 'OTHER', 'ER'); er.params.ER.periods = [{ name: 'Day', hoursPerDay: 16, minRN: 1 }, { name: 'Night', hoursPerDay: 12, minRN: 1 }];
  const r = C.calculate(state([bad, zero, neg, dup1, dup2, er]));
  const msgs = errors(r).map(e => e.message).join('\n');
  assert.match(msgs, /Occupancy % must not exceed 100/);
  assert.match(msgs, /Patients per RN must be greater than zero/);
  assert.match(msgs, /headcount cannot be negative/);
  assert.match(msgs, /Duplicate unit name/);
  assert.match(msgs, /add up to 28 hours/);
  const dupId = C.calculate(state([ward('X'), ward('X', { name: 'Other' })]));
  assert.ok(errors(dupId).some(e => /Duplicate unit ID/.test(e.message)));
});

test('archived units are excluded from calculations', () => {
  const r = C.calculate(state([ward('A'), ward('B', { archived: true })]));
  assert.equal(r.units.length, 1);
  assert.equal(r.summary.currentRNHC, 20);
});

// -----------------------------------------------------------------------------
// Workbook regression: known errors must not be reproduced.
// -----------------------------------------------------------------------------
function seedState() { return state(E.getSeedUnits_()); }

test('workbook: no omitted rows — all 25 units and 392 current RN are counted', () => {
  const r = C.calculate(seedState());
  assert.equal(r.units.length, 25);
  assert.equal(r.summary.currentRNHC, 392); // workbook old total dropped Anesthesia (388)
  assert.ok(r.units.some(u => u.name === 'Anesthesia – NU' && u.currentHC === 4 && u.counted));
});

test('workbook: recruitment is NOT Required − (RN + PCA + CNC)', () => {
  const r = C.calculate(seedState());
  const wrong = r.summary.requiredRNFTE - (r.summary.currentRNHC + 54 + 35);
  assert.notEqual(r.summary.recruitmentFTE, Math.max(0, wrong));
  const sumShort = C.round2(r.units.filter(u => u.remainingShortage !== null).reduce((a, u) => a + u.remainingShortage, 0));
  assert.equal(r.summary.recruitmentFTE, sumShort);
});

test('workbook: OR is not sized from beds × occupancy ÷ ratio', () => {
  const r = C.calculate(seedState());
  const or = unitRes(r, 'U-OR');
  assert.equal(or.method, 'OR');
  assert.equal(or.status, C.STATUS.DATA);
  assert.equal(or.requiredFTE, null);
});

test('workbook: one consistent hours-per-FTE divisor for every unit (no 1.15 vs 1.5 mix)', () => {
  const s = seedState();
  s.units.forEach(u => { if (u.section === 'OTHER' && u.method !== 'CLINIC') { u.manualOverrideFTE = 3; u.manualOverrideReason = 'test'; } });
  const r = C.calculate(s);
  r.units.filter(u => u.status !== C.STATUS.OVERRIDE && u.requiredFTE !== null).forEach(u => {
    close(u.requiredFTE, C.round2(u.coverageHours / r.hours.hoursPerFTE), 1e-9);
  });
});

test('workbook: overtime uses one limit for every unit (no drifting references)', () => {
  const s = seedState();
  s.settings.otMaxHoursPerRN = 12;
  const r = C.calculate(s);
  r.units.filter(u => u.requiredFTE !== null).forEach(u => {
    assert.equal(u.otCapacity, u.otEligibleHC * 12);
    assert.equal(u.feasibleOT, Math.min(u.uncoveredHours, u.otCapacity));
  });
});

test('summary reconciliation and rounding on the seed data', () => {
  const r = C.calculate(seedState());
  assert.ok(r.checks.every(c => c.ok), JSON.stringify(r.checks.filter(c => !c.ok)));
  const known = r.units.filter(u => u.counted && u.requiredFTE !== null);
  assert.equal(r.summary.requiredRNFTE, C.round2(known.reduce((a, u) => a + u.requiredFTE, 0)));
  assert.equal(r.summary.establishment, known.reduce((a, u) => a + Math.ceil(u.requiredFTE - 1e-7), 0));
  known.forEach(u => assert.equal(u.requiredFTE, C.round2(u.requiredFTE)));
  close(r.summary.netGapFTE, r.summary.surplusFTE - r.summary.shortageFTE, 1e-9);
  assert.equal(r.summary.totalWorkforceHC, 392 + 54 + 35);
  assert.equal(r.summary.provisional, true, 'Data Required units and unresolved subsets keep the total provisional');
  assert.equal(errors(r).length, 0);
});

test('rounding: exact multiples do not round up an extra post', () => {
  const s = state([ward('W')], { settings: baseSettings({ scheduledHoursOverride: 184, leaveHours: 0, trainingHours: 0, otherUnavailableHours: 0 }) });
  s.units[0].params.RATIO = { beds: 8, occupancyPct: 100, patientsPerRN: 1 }; // 8 RN × 744 h = 5952 h
  s.units[0].schedule = { weekdayHours: 23, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 23, holidayHours: 23 }; // 8 × 713 = 5704 = 31 × 184
  const w = unitRes(C.calculate(s), 'W');
  assert.equal(w.requiredFTE, 31);
  assert.equal(w.establishment, 31);
});

test('switching method carries shared inputs (beds) and keeps the old method inputs', () => {
  const u = ward('W');
  C.switchMethod(u, 'ACUITY');
  assert.equal(u.method, 'ACUITY');
  assert.equal(u.params.ACUITY.beds, 20, 'beds carried over');
  assert.equal(u.params.RATIO.occupancyPct, 80, 'ratio inputs kept');
  u.params.ACUITY.beds = 18;
  C.switchMethod(u, 'RATIO');
  assert.equal(u.params.RATIO.beds, 20, 'existing value not overwritten');
});
