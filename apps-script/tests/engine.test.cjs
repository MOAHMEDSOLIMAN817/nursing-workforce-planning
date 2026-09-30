'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./gas-mock.cjs');

const E = loadEngine();
const C = E.NwcCalc;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// October 2026: 31 days, 5 Fridays. Available hours per FTE = 48 × 31 / 7 (no automatic leave deduction in v3).
const HPF = 48 * 31 / 7;
function baseSettings(over) { return Object.assign(C.defaultSettings(), { reportingMonth: '2026-10' }, over || {}); }
function state(units, over) {
  return Object.assign({ settings: baseSettings(), units, transfers: [], contributions: [] }, over || {});
}
/** 20 beds × 80% ÷ 4 = 4 RN × 744 h = 2976 h → 2976 / HPF FTE (≈ 16.30). */
function ward(id, over) {
  const u = C.newUnit(id, id, 'INPATIENT', 'RATIO');
  u.params.RATIO = { beds: 20, occupancyPct: 80, patientsPerRN: 4, shiftCensus: '' };
  u.currentRNHeadcount = 20;
  return Object.assign(u, over || {});
}
const WARD_REQ = 4 * 744 / HPF;
function alloc(id, category, unitId, fte, pct, over) {
  return Object.assign({ id, category, staffRef: '', unitId, allocatedFTE: fte, contributionPct: pct, approved: true, countedInRNFTE: false, notes: '' }, over || {});
}
function unitRes(r, id) { return r.units.find(u => u.id === id); }
function errors(r) { return r.issues.filter(i => i.level === 'error'); }
function errText(r) { return errors(r).map(e => e.message).join('\n'); }

// -----------------------------------------------------------------------------
// Calendar, hours, methods (unchanged behaviour)
// -----------------------------------------------------------------------------
test('calendar: actual days and Fridays for the reporting month', () => {
  const mi = C.monthInfo('2026-10');
  assert.equal(mi.days, 31);
  assert.equal(mi.fridays, 5);
  assert.equal(C.monthInfo('2028-02').days, 29);
  assert.equal(C.monthInfo('bad'), null);
});

test('hours per FTE: available hours are not reduced by leave; leave hours only suggest a factor', () => {
  const mi = C.monthInfo('2026-10');
  const h = C.hoursModel(baseSettings(), mi);
  close(h.hoursPerFTE, HPF);
  assert.equal(h.applyReliefFactor, false);
  assert.equal(h.effectiveFactor, 1);
  close(h.productiveHoursPerFTE, HPF);
  close(h.suggestedFactor, HPF / (HPF - 30));
  assert.equal(C.hoursModel(baseSettings({ leaveHours: 100 }), mi).hoursPerFTE, h.hoursPerFTE, 'leave never deducted');
  assert.equal(C.hoursModel(baseSettings({ scheduledHoursOverride: 208 }), mi).hoursPerFTE, 208);
  assert.equal(C.hoursModel(baseSettings({ fteMode: 'UPLIFT', reliefUpliftPct: 40 }), mi).hoursPerFTE, h.hoursPerFTE, 'legacy fields ignored');
  const w = unitRes(C.calculate(state([ward('W')])), 'W');
  close(w.requiredFTE, w.coverageHours / HPF);
});

test('full precision is kept; rounding is display-only', () => {
  const u = ward('W'); u.params.RATIO.beds = 19;   // 15.2 ÷ 4 = 3.8 RN × 744 h = 2827.2 h
  const w = unitRes(C.calculate(state([u])), 'W');
  close(w.requiredFTE, 2827.2 / HPF, 1e-12);
  assert.notEqual(w.requiredFTE, Math.round(w.requiredFTE * 100) / 100, 'not pre-rounded');
  assert.equal(w.establishment, Math.ceil(2827.2 / HPF));
});

test('inpatient ratio and minimum; zero activity open vs closed', () => {
  const w = unitRes(C.calculate(state([ward('W')])), 'W');
  assert.equal(w.occupied, 16);
  close(w.coverageHours, 4 * 744);
  const open = ward('O', { minRNPerShift: 2 }); open.params.RATIO.beds = 0;
  const shut = ward('X', { isOpen: false }); shut.params.RATIO.beds = 0;
  const r = C.calculate(state([open, shut]));
  close(unitRes(r, 'O').coverageHours, 2 * 744);
  const x = unitRes(r, 'X');
  assert.equal(x.status, C.STATUS.CLOSED);
  assert.equal(x.requiredFTE, 0);
  assert.equal(x.adjustedGap, -20, 'closed unit staff are surplus (negative gap)');
});

test('average-workload FTE vs whole-shift FTE; the selected basis drives the requirement', () => {
  const u = ward('W'); u.params.RATIO = { beds: 10, occupancyPct: 70, patientsPerRN: 3 }; // 7 ÷ 3 = 2.33 avg; whole = 3
  let w = unitRes(C.calculate(state([u])), 'W');
  close(w.avgFTE, 7 / 3 * 744 / HPF);
  close(w.shiftFTE, 3 * 744 / HPF);
  assert.equal(w.basis, 'AVERAGE');
  close(w.requiredFTE, w.avgFTE);
  w = unitRes(C.calculate(state([u], { settings: baseSettings({ requirementBasis: 'WHOLE_SHIFT' }) })), 'W');
  assert.equal(w.basis, 'WHOLE_SHIFT');
  close(w.requiredFTE, w.shiftFTE);
  close(w.coverageHours, 3 * 744, 1e-9);
});

test('missing workload data → Data Required (null, never zero)', () => {
  const or = C.newUnit('OR', 'OR', 'OTHER', 'OR'); or.params.OR.rooms = 4; or.currentRNHeadcount = 23;
  const r = C.calculate(state([ward('W'), or]));
  const o = unitRes(r, 'OR');
  assert.equal(o.status, C.STATUS.DATA);
  for (const k of ['requiredFTE', 'rnGap', 'adjustedGap', 'uncoveredHours', 'feasibleOT', 'remainingRecruitFTE', 'otCost']) assert.equal(o[k], null, k);
  assert.equal(r.summary.provisional, true);
  assert.equal(r.summary.totalsLabel, 'Completed units only — provisional');
});

test('partial data: required and available FTE are compared over exactly the same units', () => {
  const or = C.newUnit('OR', 'OR', 'OTHER', 'OR'); or.currentRNHeadcount = 23;
  const r = C.calculate(state([ward('W'), or]));
  const sm = r.summary;
  assert.equal(sm.completedUnits, 1);
  close(sm.requiredFTE, WARD_REQ);
  assert.equal(sm.currentRNFTE, 20, 'OR staff excluded from available because its requirement is unknown');
  assert.equal(sm.currentRNFTEAllUnits, 43);
  assert.equal(sm.currentFTEInDataRequiredUnits, 23);
  close(sm.rnShortageFTE - sm.rnSurplusFTE, WARD_REQ - 20);
});

test('manual override requires a reason', () => {
  const u = C.newUnit('A', 'Anes', 'OTHER', 'POSTS'); u.currentRNHeadcount = 4; u.manualOverrideFTE = 5;
  let r = C.calculate(state([u]));
  assert.match(errText(r), /requires a reason/);
  u.manualOverrideReason = 'Theatre data pending';
  r = C.calculate(state([u]));
  const a = unitRes(r, 'A');
  assert.equal(a.status, C.STATUS.OVERRIDE);
  assert.equal(a.requiredFTE, 5);
  assert.equal(a.rnGap, 1, 'gap = required 5 − credited 4 = +1 shortage');
});

// -----------------------------------------------------------------------------
// Sign convention and contributions
// -----------------------------------------------------------------------------
test('signed gap = required − credited: positive = shortage, negative = surplus', () => {
  const r = C.calculate(state([ward('S', { currentRNHeadcount: 10 }), ward('P', { currentRNHeadcount: 25 })]));
  close(unitRes(r, 'S').rnGap, WARD_REQ - 10);
  assert.ok(unitRes(r, 'S').rnGap > 0);
  close(unitRes(r, 'P').rnGap, WARD_REQ - 25);
  assert.ok(unitRes(r, 'P').rnGap < 0);
  assert.equal(unitRes(r, 'S').status, C.STATUS.GAP);
  assert.equal(unitRes(r, 'P').status, C.STATUS.MET);
});

test('per-unit gaps: one unit\'s surplus never offsets another unit\'s shortage', () => {
  const r = C.calculate(state([ward('S', { currentRNHeadcount: 10 }), ward('P', { currentRNHeadcount: 25 })]));
  close(r.summary.finalShortageFTE, WARD_REQ - 10);
  close(r.summary.finalSurplusFTE, 25 - WARD_REQ);
  assert.ok(r.summary.finalShortageFTE > r.summary.finalShortageFTE - r.summary.finalSurplusFTE, 'net would understate');
});

test('CNC credit = allocated FTE × qualified direct-care % (after admin); enters RN gap', () => {
  const s = state([ward('W', { currentRNHeadcount: 10 })], { contributions: [alloc('a', 'CNC', 'W', 1, 40)] });
  const w = unitRes(C.calculate(s), 'W');
  close(w.cncFTE, 0.4);
  close(w.rnGap, WARD_REQ - 10.4);
  close(w.adjustedGap, w.rnGap);
  // Default % from Settings when the row has none.
  s.contributions[0].contributionPct = '';
  close(unitRes(C.calculate(s), 'W').cncFTE, 0.25);
});

test('PCA/PCT credit enters only the adjusted gap, capped per unit; never RN coverage', () => {
  const s = state([ward('W', { currentRNHeadcount: 10 })], { contributions: [alloc('p', 'PCA', 'W', 4, 50)] });
  const r = C.calculate(s);
  const w = unitRes(r, 'W');
  close(w.pcaFTE, 2);
  close(w.rnGap, WARD_REQ - 10, 1e-9);
  close(w.adjustedGap, WARD_REQ - 12);
  assert.equal(w.status, C.STATUS.GAP, 'status reflects qualified RN coverage');
  assert.equal(r.summary.scenarioApproved, false, 'planning scenario until approved');
  // Cap: 20% of required FTE.
  s.contributions[0].allocatedFTE = 30; s.contributions[0].contributionPct = 100;
  s.settings.pcaFTE = 54;
  const w2 = unitRes(C.calculate(s), 'W');
  close(w2.pcaFTE, WARD_REQ * 0.2);
  assert.equal(w2.pcaCapped, true);
});

test('contribution limits: allocations cannot exceed available CNC / PCA FTE', () => {
  const s = state([ward('A'), ward('B')], { settings: baseSettings({ cncFTE: 1.5 }), contributions: [alloc('1', 'CNC', 'A', 1, 50), alloc('2', 'CNC', 'B', 1, 50)] });
  assert.match(errText(C.calculate(s)), /CNC allocations total 2 FTE, more than the 1.5 FTE available/);
  s.settings.cncFTE = 2;
  assert.equal(errors(C.calculate(s)).length, 0);
  s.settings.cncFTE = 40; s.settings.cncHeadcount = 35;
  assert.match(errText(C.calculate(s)), /FTE cannot exceed headcount/);
});

test('duplicate allocations and one employee above 1.0 FTE are rejected', () => {
  const dupGroup = state([ward('A')], { contributions: [alloc('1', 'PCA', 'A', 2, 20), alloc('2', 'PCA', 'A', 1, 20)] });
  assert.match(errText(C.calculate(dupGroup)), /duplicate allocation/);
  const person = state([ward('A'), ward('B')], { contributions: [
    alloc('1', 'CNC', 'A', 0.6, 50, { staffRef: 'CNC-07' }), alloc('2', 'CNC', 'B', 0.6, 50, { staffRef: 'cnc-07' })] });
  assert.match(errText(C.calculate(person)), /cannot exceed 1.0 FTE/);
  person.contributions[1].allocatedFTE = 0.4;
  assert.equal(errors(C.calculate(person)).length, 0, 'split 0.6 + 0.4 across units is fine');
  const samePersonSameUnit = state([ward('A')], { contributions: [alloc('1', 'CNC', 'A', 0.3, 50, { staffRef: 'X' }), alloc('2', 'CNC', 'A', 0.3, 50, { staffRef: 'X' })] });
  assert.match(errText(C.calculate(samePersonSameUnit)), /duplicate allocation/);
});

test('no double counting of staff already in current RN FTE; unapproved rows not credited', () => {
  const s = state([ward('W', { currentRNHeadcount: 10 })], { contributions: [
    alloc('1', 'CNC', 'W', 1, 50, { countedInRNFTE: true, staffRef: 'CNC-1' }),
    alloc('2', 'CNC', 'W', 1, 50, { approved: false, staffRef: 'CNC-2' })] });
  const r = C.calculate(s);
  assert.equal(unitRes(r, 'W').cncFTE, 0);
  assert.deepEqual(r.contributions.map(c => c.eligible).join(), 'false,false');
  assert.match(r.contributions[0].reasons.join(), /Already counted/);
  assert.equal(r.summary.totalHC, 10 + 35 + 54, 'headcount counted once per category');
});

test('unallocated CNC/PCA capacity is never credited', () => {
  const r = C.calculate(state([ward('W', { currentRNHeadcount: 10 })]));
  assert.equal(r.summary.cncCreditedFTE, 0);
  assert.equal(r.summary.pcaCreditedFTE, 0);
  assert.equal(r.summary.cncAvailableFTE, 35);
  assert.equal(r.summary.pcaAvailableFTE, 54);
});

test('waterfall: per-unit shortage after each credit; steps reconcile to final', () => {
  const s = state([ward('A', { currentRNHeadcount: 8 }), ward('B', { currentRNHeadcount: 30 })], {
    contributions: [alloc('c', 'CNC', 'A', 2, 50), alloc('p', 'PCA', 'A', 4, 25)],
    transfers: [{ id: 't', sourceUnitId: 'B', destUnitId: 'A', fte: 3, competencyConfirmed: true, coverageCompatible: true }]
  });
  const r = C.calculate(s);
  const w = Object.fromEntries(r.summary.waterfall.map(x => [x.key, x.value]));
  close(w.gross, WARD_REQ - 8);
  close(w.cnc, -1);
  close(w.transfer, -3);
  close(w.rn, WARD_REQ - 12);
  close(w.pca, -1);
  close(w.final, WARD_REQ - 13);
  assert.ok(r.checks.every(c => c.ok), JSON.stringify(r.checks.filter(c => !c.ok)));
});

// -----------------------------------------------------------------------------
// Transfers
// -----------------------------------------------------------------------------
test('transfers: only confirmed compatible transfers count, never creating a source shortage', () => {
  const src = ward('SRC', { currentRNHeadcount: 30 }), dst = ward('DST', { currentRNHeadcount: 10 });
  const spare = 30 - WARD_REQ;
  const mk = (fte, comp, cov) => ({ id: 't' + fte, sourceUnitId: 'SRC', destUnitId: 'DST', fte, competencyConfirmed: comp, coverageCompatible: cov });
  let r = C.calculate(state([src, dst], { transfers: [mk(2, false, true)] }));
  assert.equal(r.transfers[0].valid, false);
  close(unitRes(r, 'DST').rnGap, WARD_REQ - 10);
  r = C.calculate(state([src, dst], { transfers: [mk(2, true, false)] }));
  assert.equal(r.transfers[0].valid, false, 'coverage compatibility required');
  r = C.calculate(state([src, dst], { transfers: [mk(2, true, true)] }));
  assert.equal(r.transfers[0].valid, true);
  close(unitRes(r, 'DST').rnGap, WARD_REQ - 12);
  close(unitRes(r, 'SRC').rnGap, WARD_REQ - 28);
  r = C.calculate(state([src, dst], { transfers: [mk(spare + 0.5, true, true)] }));
  assert.equal(r.transfers[0].valid, false);
  assert.match(r.transfers[0].reasons.join(), /shortage in the source/);
  r = C.calculate(state([src, dst], { transfers: [mk(spare - 1, true, true), mk(2, true, true)] }));
  assert.equal(r.transfers.map(t => t.valid).join(), 'true,false', 'cumulative check');
});

test('transfer spare uses qualified coverage only: PCA credit cannot free RNs to transfer', () => {
  const src = ward('SRC', { currentRNHeadcount: 15 }), dst = ward('DST', { currentRNHeadcount: 10 });  // spare 1 FTE
  const s = state([src, dst], {
    contributions: [alloc('p', 'PCA', 'SRC', 10, 100)],
    transfers: [{ id: 't', sourceUnitId: 'SRC', destUnitId: 'DST', fte: 2, competencyConfirmed: true, coverageCompatible: true }]
  });
  const r = C.calculate(s);
  assert.equal(r.transfers[0].valid, false);
});

test('transfers involving a Data Required unit are rejected', () => {
  const or = C.newUnit('OR', 'OR', 'OTHER', 'OR'); or.currentRNHeadcount = 23;
  const r = C.calculate(state([or, ward('W')], { transfers: [{ id: 't', sourceUnitId: 'OR', destUnitId: 'W', fte: 3, competencyConfirmed: true, coverageCompatible: true }] }));
  assert.equal(r.transfers[0].valid, false);
  assert.match(r.transfers[0].reasons.join(), /Data Required/);
});

// -----------------------------------------------------------------------------
// Estimated overtime required
// -----------------------------------------------------------------------------
const OT = over => baseSettings(Object.assign({ otEligiblePct: 100 }, over || {}));

test('overtime: zero shortage → 0 uncovered, 0 feasible, 0 recruitment (even without eligibility)', () => {
  const r = C.calculate(state([ward('W', { currentRNHeadcount: 25 })]));
  const w = unitRes(r, 'W');
  assert.equal(w.uncoveredHours, 0);
  assert.equal(w.feasibleOT, 0);
  assert.equal(w.remainingRecruitFTE, 0);
  assert.equal(w.otCost, 0);
});

test('overtime: per-unit formula chain with insufficient capacity', () => {
  const r = C.calculate(state([ward('W', { currentRNHeadcount: 10 })], { settings: OT() }));
  const w = unitRes(r, 'W');
  close(w.requiredHours, 2976);
  close(w.availableQualifiedHours, 10 * HPF);
  close(w.uncoveredHours, 2976 - 10 * HPF);
  assert.equal(w.otEligibleHC, 10);
  assert.equal(w.otCapacity, 480, '10 eligible RN × 48 h default');
  assert.equal(w.feasibleOT, 480);
  close(w.remainingUncoveredHours, w.uncoveredHours - 480);
  close(w.remainingRecruitFTE, (w.uncoveredHours - 480) / HPF);
  assert.equal(w.otCost, 'RATE', 'no hourly rate → Rate Required');
  const r2 = C.calculate(state([ward('W', { currentRNHeadcount: 10 })], { settings: OT({ costOTPerHour: 90 }) }));
  assert.equal(unitRes(r2, 'W').otCost, 480 * 90);
});

test('overtime: capacity sufficient → remaining uncovered 0; max hours editable', () => {
  const r = C.calculate(state([ward('W', { currentRNHeadcount: 13 })], { settings: OT({ otMaxHoursPerRN: 60 }) }));
  const w = unitRes(r, 'W');
  close(w.uncoveredHours, 2976 - 13 * HPF);
  assert.ok(w.uncoveredHours > 0);
  assert.ok(w.uncoveredHours < 900);
  close(w.feasibleOT, w.uncoveredHours);
  assert.equal(w.remainingUncoveredHours, 0);
  assert.equal(w.remainingRecruitFTE, 0);
});

test('overtime eligibility: not assumed; global % and unit override', () => {
  let w = unitRes(C.calculate(state([ward('W', { currentRNHeadcount: 10 })])), 'W');
  assert.equal(w.otEligibleHC, null, 'blank global eligibility is not "everyone"');
  assert.equal(w.feasibleOT, null);
  assert.equal(w.remainingRecruitFTE, null);
  w = unitRes(C.calculate(state([ward('W', { currentRNHeadcount: 10 })], { settings: OT({ otEligiblePct: 50 }) })), 'W');
  assert.equal(w.otEligibleHC, 5);
  assert.equal(w.otCapacity, 240);
  w = unitRes(C.calculate(state([ward('W', { currentRNHeadcount: 10, otEligibleHeadcount: 2 })], { settings: OT({ otEligiblePct: 50 }) })), 'W');
  assert.equal(w.otEligibleHC, 2);
  assert.equal(w.otEligibleSource, 'Unit override');
  assert.equal(w.otCapacity, 96);
  const bad = C.calculate(state([ward('W', { currentRNHeadcount: 10, otEligibleHeadcount: 11 })]));
  assert.match(errText(bad), /Overtime-eligible headcount/);
});

test('overtime: CNC contribution and confirmed transfers reduce uncovered hours', () => {
  const base = unitRes(C.calculate(state([ward('W', { currentRNHeadcount: 10 })], { settings: OT() })), 'W').uncoveredHours;
  const s = state([ward('W', { currentRNHeadcount: 10 }), ward('D', { currentRNHeadcount: 30 })], {
    settings: OT(), contributions: [alloc('c', 'CNC', 'W', 1, 50)],
    transfers: [{ id: 't', sourceUnitId: 'D', destUnitId: 'W', fte: 2, competencyConfirmed: true, coverageCompatible: true }] });
  const w = unitRes(C.calculate(s), 'W');
  close(w.uncoveredHours, base - 2.5 * HPF);
});

test('overtime: PCA/PCT does not cover RN overtime gaps unless the approved model removes those hours', () => {
  const s = state([ward('W', { currentRNHeadcount: 10 })], { settings: OT(), contributions: [alloc('p', 'PCA', 'W', 4, 50)] });
  const a = unitRes(C.calculate(s), 'W');
  close(a.uncoveredHours, 2976 - 10 * HPF);
  s.settings.pcaReducesRNWorkload = 'YES';
  const b = unitRes(C.calculate(s), 'W');
  close(b.uncoveredHours, 2976 - 10 * HPF - 2 * HPF);
});

test('overtime summary: missing eligibility on a short unit → totals Data Required, not zero', () => {
  const s = state([ward('A', { currentRNHeadcount: 10 }), ward('B', { currentRNHeadcount: 10, otEligibleHeadcount: 5 })]);
  const sm = C.calculate(s).summary;
  assert.equal(sm.feasibleOTHours, null);
  assert.equal(sm.remainingRecruitFTE, null);
  assert.equal(sm.otCost, null);
  assert.equal(sm.otDataMissingUnits, 1);
  assert.ok(sm.uncoveredHours > 0);
  const ok = C.calculate(state(s.units, { settings: OT({ costOTPerHour: 100 }) }));
  assert.ok(ok.checks.every(c => c.ok), JSON.stringify(ok.checks.filter(c => !c.ok)));
  close(ok.summary.otCost, ok.summary.feasibleOTHours * 100);
});

// -----------------------------------------------------------------------------
// Methods, unit types, validation
// -----------------------------------------------------------------------------
test('OPD units are restricted to clinic-based or patient-volume-based methods', () => {
  const u = C.newUnit('O', 'OPD', 'OTHER', 'CLINIC', 'OPD');
  assert.deepEqual(C.allowedMethods(u).join(), 'CLINIC,ACTIVITY');
  u.method = 'POSTS'; u.params.POSTS = { rnPosts: 3 };
  assert.match(errText(C.calculate(state([u]))), /Outpatient \(OPD\) units may only use/);
});

test('method switch never reinterprets old parameters; switching back restores them', () => {
  const u = ward('W');
  C.switchMethod(u, 'ACUITY');
  assert.equal(u.method, 'ACUITY');
  assert.equal(u.params.ACUITY.beds, '', 'beds NOT copied from ratio inputs');
  assert.equal(unitRes(C.calculate(state([u])), 'W').status, C.STATUS.DATA);
  C.switchMethod(u, 'RATIO');
  assert.equal(u.params.RATIO.beds, 20);
  assert.equal(u.params.RATIO.occupancyPct, 80);
  const o = C.newUnit('O', 'OPD', 'OTHER', 'CLINIC', 'OPD');
  o.params.CLINIC = { clinics: 10, utilisationPct: 50, rnPerClinic: 1 };
  C.switchMethod(o, 'ACTIVITY');
  assert.equal(o.params.ACTIVITY.activitiesPerMonth, '');
});

test('OPD clinic vs patient volume are exclusive; Friday schedule', () => {
  const u = C.newUnit('O', 'OPD', 'OTHER', 'CLINIC', 'OPD'); u.minRNPerShift = 0;
  u.schedule = { weekdayHours: 10, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  u.params.CLINIC = { clinics: 10, utilisationPct: 50, rnPerClinic: 1 };
  u.params.ACTIVITY = { activitiesPerMonth: 3000, minutesPerActivity: 20, supportHoursPerMonth: 100 };
  close(unitRes(C.calculate(state([u])), 'O').coverageHours, 5 * 10 * 26);
  u.schedule.fridayHours = 4;
  close(unitRes(C.calculate(state([u])), 'O').coverageHours, 5 * (10 * 26 + 4 * 5));
  u.method = 'ACTIVITY';
  close(unitRes(C.calculate(state([u])), 'O').coverageHours, 3000 * 20 / 60 + 100);
});

test('OR, ER, procedures and CSSD methods', () => {
  const or = C.newUnit('OR', 'OR', 'OTHER', 'OR'); or.minRNPerShift = 1;
  or.schedule = { weekdayHours: 10, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  or.params.OR = { rooms: 4, rnPerRoom: 2, prepMinutesPerRoomDay: 30, recoveryRN: 2, emergencyRN: 1 };
  const er = C.newUnit('ER', 'ER', 'OTHER', 'ER');
  er.params.ER = { periods: [{ name: 'Day', hoursPerDay: 12, minRN: 3 }, { name: 'Night', hoursPerDay: 12, minRN: 2 }],
    workload: [{ period: 'Day', acuity: 'High', casesPerMonth: 300, minutesPerCase: 180 }, { period: 'Night', acuity: 'High', casesPerMonth: 100, minutesPerCase: 180 }] };
  const cs = C.newUnit('CSSD', 'CSSD', 'OTHER', 'CSSD'); cs.minRNPerShift = 1;
  cs.schedule = { weekdayHours: 16, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 8, holidayHours: 8 };
  cs.params.CSSD = { rnPosts: 1, setsPerMonth: 3000, techMinutesPerSet: 20 };
  const r = C.calculate(state([or, er, cs]));
  const open = 260;
  close(unitRes(r, 'OR').coverageHours, 8 * open + 4 * 0.5 * 26 + 2 * open + (744 - open));
  close(unitRes(r, 'ER').coverageHours, Math.max(900, 3 * 372) + Math.max(300, 2 * 372));
  const x = unitRes(r, 'CSSD');
  close(x.coverageHours, 26 * 16 + 5 * 8);
  close(x.technicians.requiredFTE, 1000 / HPF);
});

test('validation: ranges, negatives, duplicate names, acuity overlap, ER hours', () => {
  const bad = ward('B'); bad.params.RATIO.occupancyPct = 120;
  const neg = ward('N', { currentRNHeadcount: -1 });
  const d1 = ward('D1', { name: 'Ward A' }), d2 = ward('D2', { name: 'ward  a' });
  const ac = C.newUnit('I', 'ICU', 'INPATIENT', 'ACUITY');
  ac.params.ACUITY = { beds: 5, groups: [{ name: 'A', patients: 4, patientsPerRN: 1 }, { name: 'a', patients: 3, patientsPerRN: 1 }] };
  const er = C.newUnit('ER', 'ER', 'OTHER', 'ER'); er.params.ER.periods = [{ name: 'Day', hoursPerDay: 16, minRN: 1 }, { name: 'Night', hoursPerDay: 12, minRN: 1 }];
  const msgs = errText(C.calculate(state([bad, neg, d1, d2, ac, er])));
  for (const re of [/Occupancy % must not exceed 100/, /headcount cannot be negative/, /Duplicate unit name/, /mutually exclusive/, /groups overlap/, /add up to 28 hours/]) assert.match(msgs, re);
  const fteHc = C.calculate(state([ward('W', { currentRNHeadcount: 5, currentRNFTE: 6 })]));
  assert.match(errText(fteHc), /exceeds headcount/);
});

test('subset / duplicate relations: unresolved provisional; confirmed exclusion', () => {
  const parent = ward('P'), child = ward('C', { relation: { type: 'SUBSET_OF', unitId: 'P', resolution: 'UNRESOLVED' } });
  let r = C.calculate(state([parent, child]));
  assert.equal(r.summary.provisional, true);
  assert.equal(r.summary.totalsLabel, 'Provisional');
  child.relation.resolution = 'EXCLUDE';
  r = C.calculate(state([parent, child]));
  assert.equal(r.summary.currentRNHC, 20);
  assert.equal(r.summary.provisional, false);
});

// -----------------------------------------------------------------------------
// Workbook regressions
// -----------------------------------------------------------------------------
function seedState() { return state(E.getSeedUnits_()); }

test('workbook: all 25 units counted, 392 current RN; seed unit types set', () => {
  const r = C.calculate(seedState());
  assert.equal(r.units.length, 25);
  assert.equal(r.summary.currentRNHC, 392);
  assert.equal(r.summary.totalHC, 392 + 35 + 54);
  assert.equal(unitRes(r, 'U-OPD-SURG').unitType, 'OPD');
  assert.equal(unitRes(r, 'U-ANES').unitType, 'OTHER');
});

test('workbook: final shortage is not Required − (RN + PCA + CNC headcount)', () => {
  const r = C.calculate(seedState());
  const wrong = r.summary.requiredFTE - (392 + 54 + 35);
  assert.ok(r.summary.finalShortageFTE > 0);
  assert.notEqual(r.summary.finalShortageFTE, Math.max(0, wrong));
});

test('workbook: OR not sized by bed ratio; one hours-per-FTE divisor for all units', () => {
  const s = seedState();
  const r = C.calculate(s);
  assert.equal(unitRes(r, 'U-OR').status, C.STATUS.DATA);
  r.units.filter(u => u.requiredFTE !== null).forEach(u => close(u.requiredFTE, u.coverageHours / HPF));
});

test('seed reconciliation checks all pass', () => {
  const r = C.calculate(seedState());
  assert.equal(errors(r).length, 0);
  assert.ok(r.checks.every(c => c.ok), JSON.stringify(r.checks.filter(c => !c.ok)));
});

// -----------------------------------------------------------------------------
// v3: optional Leave & Absence Coverage (relief factor) — Delivery Room example
//   5 deliveries × 5 RN h + 3 RN × 24 h × 30 days = 2185 h; 208 h per FTE.
// -----------------------------------------------------------------------------
function deliveryRoom(current) {
  const u = C.newUnit('DR', 'Delivery Room', 'OTHER', 'DELIVERY');
  u.minRNPerShift = 3; u.currentRNHeadcount = current;
  u.schedule = { weekdayHours: 24, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 24, holidayHours: 24 };
  u.params.DELIVERY = { deliveriesPerMonth: 5, rnHoursPerDelivery: 5, otherCasesPerMonth: '', minutesPerOtherCase: '' };
  return u;
}
function drRun(current, over) {
  const s = Object.assign(C.defaultSettings(), { reportingMonth: '2026-09', scheduledHoursOverride: 208 }, over || {});
  const r = C.calculate({ settings: s, units: [deliveryRoom(current)], transfers: [], contributions: [] });
  return { r, u: r.units[0] };
}
const r2 = n => Math.round(n * 100) / 100;

test('relief TEST 1 — coverage disabled: Base 10.50 = Final 10.50', () => {
  const { u } = drRun(12);
  assert.equal(u.coverageHours, 2185);
  close(u.baseRequiredFTE, 2185 / 208);
  assert.equal(r2(u.baseRequiredFTE), 10.5);
  assert.equal(u.requiredFTE, u.baseRequiredFTE);
  assert.equal(u.coverageAdditionFTE, 0);
  assert.equal(u.reliefFactorApplied, null);
});

test('relief TEST 2 — coverage enabled at 1.17: Final 12.29, addition +1.79', () => {
  const { u } = drRun(12, { applyReliefFactor: true, reliefFactor: 1.17 });
  assert.equal(r2(u.baseRequiredFTE), 10.5);
  close(u.requiredFTE, 2185 / 208 * 1.17);
  assert.equal(r2(u.requiredFTE), 12.29);
  assert.equal(r2(u.coverageAdditionFTE), 1.79);
  assert.equal(u.reliefFactorApplied, 1.17);
});

test('relief TEST 3 — custom factor 1.10: Final ≈ 11.56', () => {
  const { u } = drRun(12, { applyReliefFactor: true, reliefFactor: 1.10 });
  assert.equal(r2(u.requiredFTE), 11.56);
});

test('relief TEST 4 — legacy record without the new fields defaults to off / 1.17', () => {
  const legacy = { reportingMonth: '2026-09', contractedWeeklyHours: 48, fteMode: 'DEDUCT', leaveHours: 20, trainingHours: 4, otherUnavailableHours: 6 };
  const r = C.calculate({ settings: legacy, units: [deliveryRoom(12)], transfers: [], contributions: [] });
  assert.equal(r.hours.applyReliefFactor, false);
  assert.equal(r.hours.reliefFactor, 1.17);
  assert.equal(r.units[0].requiredFTE, r.units[0].baseRequiredFTE);
  assert.equal(r.issues.filter(i => i.level === 'error').length, 0);
  // Missing / blank values fall back safely.
  assert.equal(C.hoursModel({ contractedWeeklyHours: 48, reliefFactor: '' }, C.monthInfo('2026-09')).reliefFactor, 1.17);
  // String booleans from the sheet are understood.
  assert.equal(C.hoursModel({ contractedWeeklyHours: 48, applyReliefFactor: 'TRUE' }, C.monthInfo('2026-09')).applyReliefFactor, true);
});

test('relief TEST 5 — gap uses FINAL required: 12.29 required vs 12 available = Shortage 0.29', () => {
  const { u } = drRun(12, { applyReliefFactor: true });
  assert.equal(u.availableFTE, 12);
  assert.equal(r2(u.adjustedGap), 0.29);
  assert.ok(u.adjustedGap > 0, 'positive = shortage');
  assert.equal(u.status, C.STATUS.GAP);
});

test('relief TEST 6 — surplus: 10.50 required vs 12 available = Surplus 1.50', () => {
  const { u } = drRun(12);
  assert.equal(r2(u.adjustedGap), -1.5);
  assert.equal(u.status, C.STATUS.MET);
});

test('relief: overtime = MAX(final − current, 0) × productive hours (factor never counted as work)', () => {
  const off = drRun(12).u;
  assert.equal(off.uncoveredHours, 0);
  const { r, u } = drRun(12, { applyReliefFactor: true, otEligiblePct: 100 });
  close(r.hours.productiveHoursPerFTE, 208 / 1.17);
  close(u.uncoveredHours, (u.requiredFTE - 12) * 208 / 1.17, 1e-6);
  close(u.uncoveredHours, 2185 - 12 * 208 / 1.17, 1e-6);   // = required hours − what 12 FTE actually cover
  close(u.remainingRecruitFTE * r.hours.productiveHoursPerFTE, u.remainingUncoveredHours, 1e-6);
  assert.ok(r.checks.every(c => c.ok), JSON.stringify(r.checks.filter(c => !c.ok)));
});

test('relief: factor applies to every method centrally; manual override is final (not multiplied)', () => {
  const on = baseSettings({ applyReliefFactor: true, reliefFactor: 1.2 });
  const ovr = C.newUnit('A', 'Anes', 'OTHER', 'POSTS'); ovr.manualOverrideFTE = 5; ovr.manualOverrideReason = 'agreed';
  const r = C.calculate(state([ward('W'), ovr], { settings: on }));
  close(unitRes(r, 'W').requiredFTE, WARD_REQ * 1.2);
  close(unitRes(r, 'W').baseRequiredFTE, WARD_REQ);
  assert.equal(unitRes(r, 'A').requiredFTE, 5);
  assert.equal(unitRes(r, 'A').coverageAdditionFTE, 0);
  close(r.summary.requiredFTE, r.summary.baseRequiredFTE + r.summary.coverageAdditionFTE);
});

test('relief: factor limits 1.00–1.50 validated', () => {
  const bad = C.calculate(state([ward('W')], { settings: baseSettings({ applyReliefFactor: true, reliefFactor: 1.8 }) }));
  assert.match(bad.issues.filter(i => i.level === 'error').map(i => i.message).join(), /Relief Factor must not exceed 1.5/);
  const low = C.calculate(state([ward('W')], { settings: baseSettings({ reliefFactor: 0.9 }) }));
  assert.match(low.issues.filter(i => i.level === 'error').map(i => i.message).join(), /Relief Factor must be at least 1/);
});
