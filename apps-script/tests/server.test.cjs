'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { createContext } = require('./gas-mock.cjs');

const J = o => JSON.parse(JSON.stringify(o));

test('initializeSystem creates sheets, seeds once and is idempotent', () => {
  const c = createContext();
  const first = c.initializeSystem();
  assert.match(first, /Seeded 25 units/);
  const ss = c.__ss;
  ['Settings', 'Units', 'Transfers', 'Contributions', 'Results', 'Audit_Log', '_Meta'].forEach(n => assert.ok(ss.getSheetByName(n), n));
  const snapshot = JSON.stringify(ss.sheets.Units.data);
  assert.match(c.initializeSystem(), /nothing changed/);
  assert.equal(JSON.stringify(ss.sheets.Units.data), snapshot);
});

test('re-running initializeSystem never overwrites saved inputs', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  d.state.units.find(u => u.id === 'U-PICU').params.RATIO.occupancyPct = 91;
  d.state.settings.leaveHours = 22;
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, true);
  // Simulate a new setting key added in a future version + a deleted header.
  const st = c.__ss.sheets.Settings;
  const idx = st.data.findIndex(r => r[0] === 'currencyLabel');
  st.data.splice(idx, 1);
  const msg = c.initializeSystem();
  assert.match(msg, /Added 1 default setting/);
  const after = c.getAppData();
  assert.equal(after.state.units.find(u => u.id === 'U-PICU').params.RATIO.occupancyPct, 91);
  assert.equal(after.state.settings.leaveHours, 22);
  assert.equal(after.state.units.length, 25);
});

test('initializeSystem does not seed when Units already has data but meta is missing', () => {
  const c = createContext();
  c.initializeSystem();
  delete c.__ss.sheets._Meta;
  const units = c.__ss.sheets.Units;
  units.data = units.data.slice(0, 3); // user kept only two units
  const msg = c.initializeSystem();
  assert.match(msg, /not seeded/);
  assert.equal(c.getAppData().state.units.length, 2);
});

test('save round-trip keeps stable IDs, persists archive and adds new units', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  const u = c.NwcCalc.newUnit('U-NEW1', 'Day Surgery', 'OTHER', 'POSTS');
  u.params.POSTS.rnPosts = 2; u.minRNPerShift = 1;
  u.schedule = { weekdayHours: 10, openDays: 'Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  d.state.units.push(J(u));
  d.state.units.find(x => x.id === 'U-CATH').archived = true;
  d.state.transfers.push({ id: 'T-1', sourceUnitId: 'U-OPD-MED', destUnitId: 'U-W3-NS1', fte: 2, competencyConfirmed: true, coverageCompatible: true, notes: 'Agreed' });
  d.state.contributions.push({ id: 'A-1', category: 'CNC', staffRef: 'CNC-07', unitId: 'U-W3-NS1', allocatedFTE: 1, contributionPct: 35, approved: true, countedInRNFTE: false, notes: '' });
  d.state.contributions.push({ id: 'A-2', category: 'PCA', staffRef: '', unitId: 'U-W3-NS1', allocatedFTE: 2, contributionPct: '', approved: true, countedInRNFTE: false, notes: 'group' });
  const res = c.saveAppData({ state: d.state, revision: d.revision });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const back = c.getAppData();
  assert.equal(back.revision, d.revision + 1);
  assert.equal(back.state.units.length, 26);
  assert.equal(back.state.units.find(x => x.id === 'U-CATH').archived, true);
  assert.equal(back.state.units.find(x => x.id === 'U-NEW1').params.POSTS.rnPosts, 2);
  assert.equal(back.state.transfers[0].fte, 2);
  assert.equal(back.state.contributions.length, 2);
  assert.deepEqual(J(back.state.contributions[0]), { id: 'A-1', category: 'CNC', staffRef: 'CNC-07', unitId: 'U-W3-NS1', allocatedFTE: 1, contributionPct: 35, approved: true, countedInRNFTE: false, notes: '' });
  assert.equal(back.state.contributions[1].contributionPct, '', 'blank % (use default) survives reload as blank');
  assert.equal(back.state.units.find(x => x.id === 'U-NEW1').unitType, 'OTHER');
  // Results sheet + audit log written.
  assert.ok(c.__ss.sheets.Results.data.some(r => r[0] === 'U-NEW1'));
  assert.ok(c.__ss.sheets.Audit_Log.data.some(r => r[2] === 'save'));
  // Server result equals client result for the same state.
  const r = c.NwcCalc.calculate(back.state);
  assert.equal(r.transfers[0].valid, true);
});

test('save is rejected when validation fails; sheet unchanged', () => {
  const c = createContext();
  c.initializeSystem();
  const before = JSON.stringify(c.__ss.sheets.Units.data);
  const d = J(c.getAppData());
  d.state.units[0].params.RATIO.occupancyPct = 130;
  d.state.units[1].manualOverrideFTE = 3; // no reason
  const res = c.saveAppData({ state: d.state, revision: d.revision });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => /Occupancy/.test(e)));
  assert.ok(res.errors.some(e => /requires a reason/.test(e)));
  assert.equal(JSON.stringify(c.__ss.sheets.Units.data), before);
});

test('stale revision is rejected (no silent overwrite of another user\'s save)', () => {
  const c = createContext();
  c.initializeSystem();
  const a = J(c.getAppData()), b = J(c.getAppData());
  a.state.units[0].currentRNHeadcount = 33;
  assert.equal(c.saveAppData({ state: a.state, revision: a.revision }).ok, true);
  b.state.units[0].currentRNHeadcount = 31;
  const res = c.saveAppData({ state: b.state, revision: b.revision });
  assert.equal(res.ok, false);
  assert.equal(res.conflict, true);
  assert.equal(c.getAppData().state.units[0].currentRNHeadcount, 33);
});

test('a saved unit omitted from the payload is kept (archive is the only removal)', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  d.state.units = d.state.units.filter(u => u.id !== 'U-CCU');
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, true);
  assert.ok(c.getAppData().state.units.some(u => u.id === 'U-CCU'));
});

test('sanitising rejects bad IDs and strips unknown fields', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  d.state.units[0].evil = '<script>';
  d.state.units.push({ id: 'bad id!', name: 'X', section: 'OTHER', method: 'POSTS' });
  const res = c.saveAppData({ state: d.state, revision: d.revision });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => /Invalid unit ID/.test(e)));
  const clean = c.sanitizeState_(J(c.getAppData()).state, []);
  assert.equal('evil' in clean.state.units[0], false);
});

test('the engine injected into the browser is the same code the server runs', () => {
  const c = createContext();
  c.initializeSystem();
  const browser = {};
  vm.createContext(browser);
  vm.runInContext(c.getEngineSource_(), browser);
  const st = J(c.getAppData().state);
  st.settings.otMaxHoursPerRN = 8;
  const a = JSON.stringify(c.NwcCalc.calculate(st));
  const b = JSON.stringify(browser.NwcCalc.calculate(JSON.parse(JSON.stringify(st))));
  assert.equal(a, b);
});

test('reporting month survives as text and settings are typed on read', () => {
  const c = createContext();
  c.initializeSystem();
  const s = c.getAppData().state.settings;
  assert.match(s.reportingMonth, /^\d{4}-\d{2}$/);
  assert.equal(typeof s.contractedWeeklyHours, 'number');
  assert.equal(s.contractedWeeklyHours, 48);
  assert.equal(s.pcaHeadcount, 54);
  assert.equal(s.cncHeadcount, 35);
  // A Date object in the cell (Sheets auto-conversion) is converted back.
  const st = c.__ss.sheets.Settings;
  const row = st.data.find(r => r[0] === 'reportingMonth');
  row[1] = new Date(Date.UTC(2026, 10, 1));
  assert.equal(c.getAppData().state.settings.reportingMonth, '2026-11');
});

test('save/reload persistence: contributions, unit type, method params and results are identical after reload', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  const opd = d.state.units.find(u => u.id === 'U-OPD-MED');
  c.NwcCalc.switchMethod(opd, 'ACTIVITY');
  opd.params.ACTIVITY = { activitiesPerMonth: 2400, minutesPerActivity: 15, supportHoursPerMonth: 20 };
  d.state.settings.otEligiblePct = 80; d.state.settings.costOTPerHour = 95; d.state.settings.requirementBasis = 'WHOLE_SHIFT';
  d.state.contributions = [{ id: 'A-9', category: 'CNC', staffRef: 'N1', unitId: 'U-PICU', allocatedFTE: 0.5, contributionPct: 40, approved: true, countedInRNFTE: false, notes: '' }];
  d.state.transfers = [{ id: 'T-9', sourceUnitId: 'U-OPD-SURG', destUnitId: 'U-PICU', fte: 0.5, competencyConfirmed: true, coverageCompatible: true, notes: '' }];
  const before = c.NwcCalc.calculate(d.state);
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, true);
  const back = c.getAppData().state;
  const after = c.NwcCalc.calculate(back);
  assert.equal(back.units.find(u => u.id === 'U-OPD-MED').method, 'ACTIVITY');
  assert.equal(back.units.find(u => u.id === 'U-OPD-MED').params.CLINIC.clinics, 30, 'inactive method inputs preserved');
  assert.equal(JSON.stringify(after.summary), JSON.stringify(before.summary));
  assert.equal(JSON.stringify(after.units.map(u => [u.id, u.requiredFTE, u.adjustedGap, u.feasibleOT])), JSON.stringify(before.units.map(u => [u.id, u.requiredFTE, u.adjustedGap, u.feasibleOT])));
});

test('save rejects over-allocation, duplicate allocation and an OPD unit on a non-OPD method', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  d.state.contributions = [
    { id: 'A-1', category: 'CNC', staffRef: '', unitId: 'U-ICU', allocatedFTE: 30, contributionPct: 20, approved: true },
    { id: 'A-2', category: 'CNC', staffRef: '', unitId: 'U-ICU', allocatedFTE: 10, contributionPct: 20, approved: true }];
  const opd = d.state.units.find(u => u.id === 'U-OPD-SURG');
  opd.method = 'POSTS'; opd.params.POSTS = { rnPosts: 2 };
  const res = c.saveAppData({ state: d.state, revision: d.revision });
  assert.equal(res.ok, false);
  const all = res.errors.join('\n');
  assert.match(all, /more than the 35 FTE available/);
  assert.match(all, /duplicate allocation/);
  assert.match(all, /OPD\) units may only use/);
});

test('v1 → v3 migration: unit types, CNC hours converted, Other & OPD manual, saved inputs untouched', () => {
  const c = createContext();
  c.initializeSystem();
  const ss = c.__ss;
  // Recreate a version-1 install: schema 1, no unit_type values, a legacy CNC sheet with hours.
  const meta = ss.sheets._Meta; meta.data.find(r => r[0] === 'schema_version')[1] = '1';
  const units = ss.sheets.Units; const col = units.data[0].indexOf('unit_type');
  units.data.forEach((r, i) => { if (i) r[col] = ''; });
  // A real v1 sheet still has the original workload methods (v3 switches Other & OPD to manual).
  const mcol = units.data[0].indexOf('method'), seedMethods = {};
  c.getSeedUnits_().forEach(u => { seedMethods[u.id] = u.method; });
  units.data.forEach((r, i) => { if (i && seedMethods[r[0]]) r[mcol] = seedMethods[r[0]]; });
  const picu = units.data.findIndex(r => r[0] === 'U-PICU');
  const occBefore = units.data[picu][units.data[0].indexOf('params_json')];
  const leg = ss.insertSheet('CNC_Contributions');
  leg.getRange(1, 1, 3, 9).setValues([
    ['contribution_id', 'cnc_ref', 'unit_id', 'qualified', 'total_hours', 'admin_hours', 'direct_care_hours', 'notes', 'updated_at'],
    ['C-1', 'CNC-01', 'U-PICU', true, 180, 120, 60, '', ''],
    ['C-2', 'CNC-02', 'U-ICU', false, 90, 0, 90, '', '']]);
  const msg = c.getAppData() && c.__ss.sheets.Audit_Log.data.map(r => r[3]).join(' ');
  assert.match(msg, /Assigned unit types to 25 unit/);
  assert.match(msg, /Migrated 2 CNC row/);
  const st = c.getAppData().state;
  assert.equal(st.units.find(u => u.id === 'U-OPD-SURG').unitType, 'OPD');
  assert.equal(st.units.find(u => u.id === 'U-OPD-SURG').method, 'CLINIC', 'OPD keeps the clinic formula');
  assert.equal(st.units.find(u => u.id === 'U-OR').method, 'MANUAL', 'v3 step ran after v2');
  assert.match(msg, /Switched 8 Other & OPD unit/);
  assert.equal(st.units.find(u => u.id === 'U-PICU').unitType, 'INPATIENT');
  const a = st.contributions.find(x => x.id === 'C-1');
  assert.equal(a.category, 'CNC');
  assert.ok(Math.abs(a.contributionPct - 100 / 3) < 1e-9, '60 of 180 h is direct care');
  assert.equal(a.approved, true);
  assert.equal(st.contributions.find(x => x.id === 'C-2').approved, false);
  assert.equal(units.data[picu][units.data[0].indexOf('params_json')], occBefore);
  assert.equal(c.getAppData().state.contributions.length, 2, 'migration runs once');
  assert.ok(leg.data.length === 3, 'legacy sheet left untouched');
});

test('relief settings: legacy sheet without the new rows loads with defaults; checkbox + factor save and reload', () => {
  const c = createContext();
  c.initializeSystem();
  // Simulate a v2 Settings sheet: remove the two new keys.
  const st = c.__ss.sheets.Settings;
  st.data = st.data.filter(r => r[0] !== 'applyReliefFactor' && r[0] !== 'reliefFactor');
  let d = J(c.getAppData());
  assert.equal(d.state.settings.applyReliefFactor, false);
  assert.equal(d.state.settings.reliefFactor, 1.17);
  // initializeSystem adds only the missing keys, without touching others.
  assert.match(c.initializeSystem(), /Added 2 default setting/);
  d = J(c.getAppData());
  d.state.settings.applyReliefFactor = true;
  d.state.settings.reliefFactor = '1.12';
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, true);
  const back = c.getAppData().state.settings;
  assert.equal(back.applyReliefFactor, true);
  assert.equal(back.reliefFactor, 1.12);
  const r = c.NwcCalc.calculate(c.getAppData().state);
  assert.equal(r.hours.effectiveFactor, 1.12);
  // Stored as TRUE in the sheet; a text "TRUE" (Sheets '@' format) reads back as true.
  const row = st.data.find(x => x[0] === 'applyReliefFactor');
  row[1] = 'TRUE';
  assert.equal(c.getAppData().state.settings.applyReliefFactor, true);
  row[1] = 'FALSE';
  assert.equal(c.getAppData().state.settings.applyReliefFactor, false);
  // Out-of-range factor is rejected by server validation.
  d = J(c.getAppData());
  d.state.settings.reliefFactor = 2;
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, false);
});

test('v3 migration on an existing v2 sheet: Other units switch to manual with their current values; OPD keeps formula; runs once', () => {
  const c = createContext();
  c.initializeSystem();
  // Rebuild a v2 sheet: original methods, schema 2.
  const ss = c.__ss, units = ss.sheets.Units, mcol = units.data[0].indexOf('method'), pcol = units.data[0].indexOf('params_json');
  const seed = {}; c.getSeedUnits_().forEach(u => { seed[u.id] = u; });
  units.data.forEach((r, i) => { if (i && seed[r[0]]) { r[mcol] = seed[r[0]].method; r[pcol] = JSON.stringify(seed[r[0]].params); } });
  ss.sheets._Meta.data.find(r => r[0] === 'schema_version')[1] = '2';
  const v2 = c.NwcCalc.calculate({ settings: c.readSettings_(), units: c.readUnits_(), transfers: [], contributions: [] });
  const msg = c.initializeSystem();
  assert.match(msg, /Switched 8 Other & OPD unit/);
  const st = c.getAppData().state;
  assert.equal(st.units.find(u => u.id === 'U-OPD-MED').method, 'CLINIC');
  const or = st.units.find(u => u.id === 'U-OR');
  assert.equal(or.method, 'MANUAL');
  assert.equal(or.params.OR.rooms, 4, 'old inputs kept for Full view');
  assert.equal(or.params.MANUAL.capacity, 4, 'beds / rooms filled from the workbook');
  assert.equal(c.NwcCalc.calculate(st).units.find(u => u.id === 'U-OPD-MED').requiredFTE, v2.units.find(u => u.id === 'U-OPD-MED').requiredFTE);
  assert.match(c.initializeSystem(), /nothing changed/);
});

test('v4 migration on a v3 sheet: OPD clinic formula restored, beds / clinics filled only where blank; runs once', () => {
  const c = createContext();
  c.initializeSystem();
  // Rebuild a v3 sheet: OPD units manual, no capacity values; one user-entered capacity to preserve.
  const d = J(c.getAppData());
  d.state.units.forEach(u => {
    if (u.unitType === 'OPD') { c.NwcCalc.switchMethod(u, 'MANUAL'); u.params.MANUAL.requiredFTE = 40; }
    if (u.params.MANUAL) u.params.MANUAL.capacity = '';
  });
  d.state.units.find(u => u.id === 'U-ER').params.MANUAL.capacity = 30;
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, true);
  c.__ss.sheets._Meta.data.find(r => r[0] === 'schema_version')[1] = '3';
  const msg = c.initializeSystem();
  assert.match(msg, /Restored the clinic formula for 2 OPD unit/);
  assert.match(msg, /Filled beds \/ clinics for 5 unit/);
  const st = c.getAppData().state;
  const surg = st.units.find(u => u.id === 'U-OPD-SURG');
  assert.equal(surg.method, 'CLINIC');
  assert.equal(surg.params.MANUAL.requiredFTE, 40, 'typed manual number kept (not used)');
  assert.equal(st.units.find(u => u.id === 'U-ER').params.MANUAL.capacity, 30, 'user value not overwritten');
  assert.equal(st.units.find(u => u.id === 'U-DR').params.MANUAL.capacity, 5);
  assert.match(c.initializeSystem(), /nothing changed/);
});

test('permanent delete: only explicitly listed units are removed; linked rows cleaned; audited', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  d.state.units = d.state.units.filter(u => u.id !== 'U-CATH' && u.id !== 'U-ENDO');   // ENDO omitted but NOT listed
  d.state.transfers = [{ id: 'T-1', sourceUnitId: 'U-OPD-MED', destUnitId: 'U-CATH', fte: 1, competencyConfirmed: true, coverageCompatible: true, notes: '' }];
  d.state.contributions = [{ id: 'A-1', category: 'CNC', staffRef: '', unitId: 'U-CATH', allocatedFTE: 1, contributionPct: 20, approved: true, countedInRNFTE: false, notes: '' }];
  d.state.units.find(u => u.id === 'U-OR').relation = { type: 'POSSIBLE_DUPLICATE_OF', unitId: 'U-CATH', resolution: 'UNRESOLVED' };
  const res = c.saveAppData({ state: d.state, revision: d.revision, deletedUnitIds: ['U-CATH', 'U-DOES-NOT-EXIST'] });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const st = c.getAppData().state;
  assert.ok(!st.units.some(u => u.id === 'U-CATH'), 'listed unit deleted');
  assert.ok(st.units.some(u => u.id === 'U-ENDO'), 'omitted but unlisted unit kept');
  assert.equal(st.units.length, 24);
  assert.equal(st.transfers.length, 0);
  assert.equal(st.contributions.length, 0);
  assert.equal(st.units.find(u => u.id === 'U-OR').relation.type, '', 'relation to the deleted unit cleared');
  assert.ok(!c.__ss.sheets.Units.data.some(r => r[0] === 'U-CATH'), 'row removed from the sheet');
  assert.ok(c.__ss.sheets.Audit_Log.data.some(r => /units deleted permanently: Cathlab \(U-CATH\)/.test(r[3])));
});
