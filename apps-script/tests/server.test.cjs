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
  ['Settings', 'Units', 'Transfers', 'CNC_Contributions', 'Results', 'Audit_Log', '_Meta'].forEach(n => assert.ok(ss.getSheetByName(n), n));
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
  d.state.cncContributions.push({ id: 'C-1', cncRef: 'CNC-07', unitId: 'U-W3-NS1', qualified: true, totalHours: 180, adminHours: 120, directCareHours: 60, notes: '' });
  const res = c.saveAppData({ state: d.state, revision: d.revision });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const back = c.getAppData();
  assert.equal(back.revision, d.revision + 1);
  assert.equal(back.state.units.length, 26);
  assert.equal(back.state.units.find(x => x.id === 'U-CATH').archived, true);
  assert.equal(back.state.units.find(x => x.id === 'U-NEW1').params.POSTS.rnPosts, 2);
  assert.equal(back.state.transfers[0].fte, 2);
  assert.equal(back.state.cncContributions[0].directCareHours, 60);
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
