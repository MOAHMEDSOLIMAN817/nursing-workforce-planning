'use strict';
/**
 * Apps Script platform constraints that Node cannot enforce by itself, plus
 * method/storage paths not covered elsewhere.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createContext, ROOT, GS_FILES } = require('./gas-mock.cjs');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const J = o => JSON.parse(JSON.stringify(o));

test('every function called from a menu or google.script.run is public and defined', () => {
  const c = createContext();
  const menu = [...read('Code.gs').matchAll(/addItem\([^,]+,\s*'([^']+)'\)/g)].map(m => m[1]);
  // Terminal call of each google.script.run chain: "}).name();" or "}).name({ state ... });"
  const rpc = [...read('Scripts.html').matchAll(/\}\)\.(\w+)\((?:\{ state[^)]*)?\);/g)].map(m => m[1]);
  assert.deepEqual([...rpc].sort(), ['getAppData', 'saveAppData']);
  assert.ok(menu.length >= 3 && rpc.length >= 2, 'found handlers');
  [...menu, ...rpc].forEach(fn => {
    assert.ok(!fn.endsWith('_'), `${fn} must not end with "_" (Apps Script private functions cannot be called)`);
    assert.equal(typeof c[fn], 'function', `${fn} is defined`);
  });
  ['doGet', 'onOpen', 'initializeSystem', 'include', 'getAppData', 'saveAppData'].forEach(fn => assert.equal(typeof c[fn], 'function', fn));
});

test('files work in any load order (clasp pushes alphabetically; editor order may differ)', () => {
  const orders = [[...GS_FILES].sort(), [...GS_FILES].reverse(), ['Setup.gs', 'Code.gs', 'Calculations.gs', 'Config.gs']];
  orders.forEach(order => {
    const c = createContext({ fileOrder: order });
    assert.match(c.initializeSystem(), /Seeded 25 units/, order.join(','));
    assert.equal(c.getAppData().state.units.length, 25);
  });
});

test('getAppData returns only values google.script.run can transfer (no Date/function/undefined)', () => {
  const c = createContext();
  c.initializeSystem();
  const d = J(c.getAppData());
  const s = c.saveAppData({ state: d.state, revision: d.revision });
  const walk = (v, p) => {
    const t = Object.prototype.toString.call(v);
    assert.ok(!['[object Date]', '[object Function]', '[object Undefined]'].includes(t), `${p} is ${t}`);
    if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], p + '.' + k));
  };
  walk(c.getAppData(), 'getAppData');
  walk(s, 'saveAppData');
});

test('manifest: V8, required scopes, web-app access valid for consumer and Workspace accounts', () => {
  const m = JSON.parse(read('appsscript.json'));
  assert.equal(m.runtimeVersion, 'V8');
  ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.container.ui'].forEach(s => assert.ok(m.oauthScopes.includes(s), s));
  assert.ok(['USER_DEPLOYING', 'USER_ACCESSING'].includes(m.webapp.executeAs));
  assert.equal(m.webapp.access, 'MYSELF', 'safe default; widen explicitly at deployment');
});

test('Index.html scriptlets reference only existing includes and the injected engine', () => {
  const html = read('Index.html');
  const scriptlets = [...html.matchAll(/<\?!?=?\s*([\s\S]*?)\?>/g)].map(m => m[1].trim());
  assert.deepEqual(scriptlets.sort(), ["engineSource", "include('Scripts');", "include('Styles');"].sort());
  ['Scripts.html', 'Styles.html'].forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f))));
  // Included files are not template-evaluated, but must not contain scriptlet markers either.
  ['Scripts.html', 'Styles.html'].forEach(f => assert.ok(!/<\?/.test(read(f)), f));
  const c = createContext();
  const src = c.getEngineSource_();
  assert.ok(!src.includes('?>') && !/<\/script/i.test(src), 'engine source safe to inline');
  assert.equal(c.include('Styles').trim().slice(0, 7), '<style>');
});

test('client-side script parses as valid JavaScript', () => {
  const js = read('Scripts.html').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  assert.doesNotThrow(() => new Function(js));
});

test('storage: user-added columns and extra settings keys survive a save', () => {
  const c = createContext();
  c.initializeSystem();
  const units = c.__ss.sheets.Units;
  const col = units.data[0].length + 1;
  units.set(1, col, 'manager_comment');
  units.set(2, col, 'keep me');
  const st = c.__ss.sheets.Settings;
  st.set(st.getLastRow() + 1, 1, 'localCustomKey'); st.set(st.getLastRow(), 2, 'x');
  const d = J(c.getAppData());
  d.state.units[0].currentRNHeadcount = 30;
  assert.equal(c.saveAppData({ state: d.state, revision: d.revision }).ok, true);
  const firstId = units.data[1][0];
  assert.equal(firstId, d.state.units[0].id);
  assert.equal(units.data[1][col - 1], 'keep me');
  assert.ok(st.data.some(r => r[0] === 'localCustomKey' && r[1] === 'x'));
});

test('storage: a deleted header column is re-added by initializeSystem without data loss', () => {
  const c = createContext();
  c.initializeSystem();
  const units = c.__ss.sheets.Units;
  const i = units.data[0].indexOf('updated_by');
  units.data.forEach(r => r.splice(i, 1));
  const msg = c.initializeSystem();
  assert.match(msg, /Units: added columns updated_by/);
  assert.equal(c.getAppData().state.units.length, 25);
});

test('Results sheet lists every active unit and the summary', () => {
  const c = createContext();
  c.initializeSystem();
  c.refreshResultsSheet();
  const res = c.__ss.sheets.Results.data;
  const ids = res.map(r => r[0]).filter(x => /^U-/.test(String(x)));
  assert.equal(ids.length, 25);
  assert.ok(res.some(r => r[0] === 'Final planning shortage FTE' && /PLANNING SCENARIO/.test(r[2])));
  assert.ok(res.some(r => r[0] === 'Totals' && r[1] === 'Completed units only — provisional'));
  assert.ok(res.some(r => r[0] === 'Remaining recruitment FTE (after feasible OT)'));
  const hdr = res.find(r => r[0] === 'Unit ID');
  ['Average-workload FTE', 'Whole-shift FTE', 'CNC FTE', 'PCA/PCT FTE', 'Remaining gap (+short)', 'Uncovered hours', 'Feasible OT hours', 'Estimated OT cost', 'Remaining recruitment FTE']
    .forEach(h => assert.ok(hdr.includes(h), h));
  const or = res.find(r => r[0] === 'U-OR');
  assert.equal(or[hdr.indexOf('Required FTE')], 'Data Required', 'missing data never written as 0');
});

test('delivery and fixed-posts methods apply workload and minimum coverage', () => {
  const { NwcCalc: C } = createContext();
  const s = Object.assign(C.defaultSettings(), { reportingMonth: '2026-10' });
  const dr = C.newUnit('DR', 'DR', 'OTHER', 'DELIVERY');
  dr.schedule = { weekdayHours: 24, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 24, holidayHours: 24 };
  dr.minRNPerShift = 1;
  dr.params.DELIVERY = { deliveriesPerMonth: 100, rnHoursPerDelivery: 12, otherCasesPerMonth: 200, minutesPerOtherCase: 30 };
  const p = C.newUnit('AN', 'Anes', 'OTHER', 'POSTS');
  p.schedule = { weekdayHours: 10, openDays: 'Sat,Sun,Mon,Tue,Wed,Thu', fridayHours: 0, holidayHours: 0 };
  p.minRNPerShift = 1; p.params.POSTS = { rnPosts: 3 };
  const r = C.calculate({ settings: s, units: [dr, p], transfers: [], contributions: [] });
  const u = id => r.units.find(x => x.id === id);
  assert.ok(Math.abs(u('DR').coverageHours - Math.max(1200 + 100, 744)) < 1e-9);
  dr.params.DELIVERY.deliveriesPerMonth = 10;
  const r2 = C.calculate({ settings: s, units: [dr], transfers: [], contributions: [] });
  assert.ok(Math.abs(r2.units[0].coverageHours - 744) < 1e-9, 'minimum 1 RN × 744 h applies');
  assert.ok(Math.abs(u('AN').coverageHours - 3 * 26 * 10) < 1e-9);
});

test('relation errors: unknown related unit and self-reference are rejected', () => {
  const { NwcCalc: C } = createContext();
  const a = C.newUnit('A', 'A', 'INPATIENT', 'RATIO');
  a.relation = { type: 'SUBSET_OF', unitId: 'NOPE', resolution: 'UNRESOLVED' };
  const b = C.newUnit('B', 'B', 'INPATIENT', 'RATIO');
  b.relation = { type: 'SUBSET_OF', unitId: 'B', resolution: 'UNRESOLVED' };
  const r = C.calculate({ settings: C.defaultSettings(), units: [a, b], transfers: [], contributions: [] });
  const msgs = r.issues.filter(i => i.level === 'error').map(i => i.message).join('\n');
  assert.match(msgs, /Related unit not found/);
  assert.match(msgs, /related to itself/);
});

test('seed: exactly the 8 expected units are Data Required, each with a missing-input list', () => {
  const c = createContext();
  c.initializeSystem();
  const r = c.NwcCalc.calculate(c.getAppData().state);
  const dr = [...r.units.filter(u => u.status === 'Data Required').map(u => u.id)].sort();
  assert.deepEqual(dr, ['U-ANES', 'U-CATH', 'U-CSSD', 'U-DR', 'U-DR-NU', 'U-ENDO', 'U-ER', 'U-OR'].sort());
  r.units.filter(u => u.status === 'Data Required').forEach(u => assert.ok(u.missing.length > 0, u.id));
});
