/**
 * End-to-end UI test (not part of `npm test`; needs Playwright + Chromium).
 *
 *   node apps-script/tests/ui-smoke.cjs [screenshotDir]
 *
 * Renders Index.html exactly as HtmlService would (includes + injected engine),
 * and routes google.script.run calls to the real Code.gs running on the
 * in-memory spreadsheet mock.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createContext, ROOT } = require('./gas-mock.cjs');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  playwright = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
}

const shotDir = process.argv[2] || null;
const gas = createContext();
gas.initializeSystem();

function renderIndex() {
  const read = n => fs.readFileSync(path.join(ROOT, n), 'utf8');
  const shim = `<script>
    window.google = { script: { run: (function () {
      function mk(ok, fail) {
        return new Proxy({}, { get: function (_, k) {
          if (k === 'withSuccessHandler') return function (h) { return mk(h, fail); };
          if (k === 'withFailureHandler') return function (h) { return mk(ok, h); };
          return function () {
            var args = Array.prototype.slice.call(arguments);
            window.__gas(k, JSON.stringify(args)).then(function (r) { ok && ok(JSON.parse(r)); }, function (e) { fail && fail(e); });
          };
        } });
      }
      return mk(null, null);
    })() } };
  </script>`;
  return read('Index.html')
    .replace("<?!= include('Styles'); ?>", read('Styles.html'))
    .replace("<?!= include('Scripts'); ?>", read('Scripts.html'))
    .replace('<?!= engineSource ?>', () => gas.getEngineSource_())
    .replace('<head>', '<head>' + shim);
}

let count = 0;
function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); count++; console.log('  ✓ ' + msg); }

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.exposeFunction('__gas', (fn, argsJson) => JSON.stringify(gas[fn].apply(null, JSON.parse(argsJson))));
  await page.setContent(renderIndex());
  await page.waitForSelector('.kpis');
  const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: true }); };
  const text = sel => page.textContent(sel);
  const saved = async () => page.waitForFunction(() => document.getElementById('savePill').textContent === 'All changes saved');
  const state = () => page.evaluate(() => NwcApp.state);
  const resOf = id => page.evaluate(i => NwcApp.result.units.find(u => u.id === i), id);
  const summary = () => page.evaluate(() => NwcApp.result.summary);

  console.log('Simple view (default)');
  check(await page.evaluate(() => document.body.classList.contains('simple')), 'opens in Simple view');
  const hero = await text('[data-region="hero"]');
  check(/Nurses needed\s*▲ [\d.]+ FTE short/.test(hero), 'headline answer: nurses needed');
  check((await page.locator('[data-region="skpis"] .kpi').count()) === 4, 'only 4 cards in Simple view');
  check((await page.locator('.wf').count()) === 0, 'no waterfall / advanced tables in Simple view');
  check((await page.locator('.chip').count()) === 8, '8 "Needs data" shortcuts');
  const firstRow = await page.locator('[data-region="stable"] tbody tr').first().textContent();
  check(firstRow.includes('Ward – 3rd Floor NS1') && firstRow.includes('Shortage'), 'units sorted by largest shortage');
  await page.click('.chip[data-id="U-OR"]');
  check((await page.evaluate(() => NwcApp.page)) === 'other', 'shortcut opens the unit page');
  console.log('Other & OPD (Simple view): required typed directly');
  check((await page.locator('#page-other .simple-detail, #page-other .expander, #page-other select').count()) === 0, 'no detail panels, method lists or dropdowns');
  check((await page.locator('#page-other thead th').allTextContents()).join('|') === 'Unit|Beds / Clinics|Required FTE|Nurses now|Gap|Status', 'columns: Unit, Beds / Clinics, Required FTE, Nurses now, Gap, Status');
  check((await page.locator('#page-other tr[data-row="U-ER"] input[data-f="params.MANUAL.capacity"]').inputValue()) === '25', 'ER shows 25 beds from the workbook');
  const orReq = page.locator('#page-other tr[data-row="U-OR"] input[data-f="params.MANUAL.requiredFTE"]');
  check((await resOf('U-OR')).status === 'Data Required', 'empty required → Data Required (not zero)');
  await orReq.fill('20');
  let orR = await resOf('U-OR');
  check(orR.requiredFTE === 20 && Math.abs(orR.adjustedGap - (20 - 23)) < 1e-9, 'typed 20 vs 23 nurses → Surplus 3.00 immediately');
  check((await text('#page-other td[data-o="u|U-OR|adjustedGap"]')).includes('Surplus 3.00'), 'gap cell shows "Surplus 3.00"');
  await orReq.fill('26');
  check((await text('#page-other td[data-o="u|U-OR|adjustedGap"]')).includes('Shortage 3.00'), 'typed 26 → "Shortage 3.00"');
  check(await orReq.evaluate(el => document.activeElement === el), 'input keeps focus while typing');
  check((await page.locator('#page-other tr[data-row="U-OPD-SURG"] input[data-f="params.MANUAL.requiredFTE"]').count()) === 0, 'OPD – Surgical has no manual input (clinic formula)');
  const surgReq = () => text('#page-other [data-region="clinicreq"][data-arg="U-OPD-SURG"]');
  const fIn = (id, f) => page.locator(`#page-other tr[data-row="${id}"] .formula input[data-f="${f}"]`);
  const vals = async id => [await page.locator(`#page-other tr[data-row="${id}"] input[data-f="params.CLINIC.clinics"]`).inputValue(),
    await fIn(id, 'params.CLINIC.utilisationPct').inputValue(), await fIn(id, 'params.CLINIC.rnPerClinic').inputValue(), await fIn(id, 'schedule.weekdayHours').inputValue()].join(' ');
  check((await vals('U-OPD-SURG')) === '70 70 0.5 12', 'OPD – Surgical formula editable: 70 clinics × 70 % × 0.5 RN × 12 h');
  check((await vals('U-OPD-MED')) === '30 70 0.25 12', 'OPD – Medical formula editable: 30 × 70 % × 0.25 RN × 12 h');
  const base0 = (await resOf('U-OPD-SURG')).requiredFTE;
  await fIn('U-OPD-SURG', 'params.CLINIC.utilisationPct').fill('80');
  check(Math.abs((await resOf('U-OPD-SURG')).requiredFTE / base0 - 80 / 70) < 1e-9, 'active % 70 → 80 recalculates immediately');
  check(await fIn('U-OPD-SURG', 'params.CLINIC.utilisationPct').evaluate(el => document.activeElement === el), 'formula input keeps focus while typing');
  await fIn('U-OPD-SURG', 'params.CLINIC.rnPerClinic').fill('1');
  check(Math.abs((await resOf('U-OPD-SURG')).requiredFTE / base0 - (80 / 70) * 2) < 1e-9, 'RN per clinic 0.5 → 1 doubles it');
  await fIn('U-OPD-SURG', 'schedule.weekdayHours').fill('8');
  check(Math.abs((await resOf('U-OPD-SURG')).requiredFTE / base0 - (80 / 70) * 2 * 8 / 12) < 1e-9, 'open hours 12 → 8 recalculates');
  check((await surgReq()).includes((await resOf('U-OPD-SURG')).requiredFTE.toFixed(2)), 'shown value matches the engine');
  await fIn('U-OPD-SURG', 'params.CLINIC.utilisationPct').fill('70');
  await fIn('U-OPD-SURG', 'params.CLINIC.rnPerClinic').fill('0.5');
  await fIn('U-OPD-SURG', 'schedule.weekdayHours').fill('12');
  check(Math.abs((await resOf('U-OPD-SURG')).requiredFTE - base0) < 1e-12, 'back to 70 % × 0.5 × 12 h gives the original value');
  const surg0 = (await resOf('U-OPD-SURG')).requiredFTE;
  await page.fill('#page-other tr[data-row="U-OPD-SURG"] input[data-f="params.CLINIC.clinics"]', '80');
  const surg1 = (await resOf('U-OPD-SURG')).requiredFTE;
  check(Math.abs(surg1 / surg0 - 80 / 70) < 1e-9 && (await surgReq()).includes(surg1.toFixed(2)), 'changing clinics 70 → 80 recalculates Required FTE by the same formula');
  await page.fill('#page-other tr[data-row="U-OPD-SURG"] input[data-f="params.CLINIC.clinics"]', '70');
  await page.fill('#page-other tr[data-row="U-OR"] input[data-f="params.MANUAL.capacity"]', '6');
  check((await resOf('U-OR')).requiredFTE === 26, 'beds / rooms for a manual unit is reference only');
  await page.click('[data-act="add-unit"][data-sec="OTHER"]');
  check((await page.locator('#modalBody select').count()) === 0, 'Add Unit asks only for a name and required FTE');
  await page.fill('#newUnitName', 'Day Surgery'); await page.fill('#newUnitCap', '8'); await page.fill('#newUnitReq', '4'); await page.click('#modalOk');
  const ds = (await state()).units.find(u => u.name === 'Day Surgery');
  check(ds && ds.method === 'MANUAL' && (await resOf(ds.id)).requiredFTE === 4 && ds.params.MANUAL.capacity === '8', 'new unit: beds / clinics 8, required 4');
  await page.click('#btnSave'); await saved();
  const saveOr = gas.getAppData().state.units.find(u => u.id === 'U-OR');
  check(saveOr.method === 'MANUAL' && saveOr.params.MANUAL.requiredFTE === 26 && saveOr.params.MANUAL.capacity === 6 && saveOr.params.OR.rooms === 4, 'manual value and beds saved; old OR inputs kept');
  check(gas.getAppData().state.units.find(u => u.id === 'U-OPD-SURG').method === 'CLINIC', 'OPD – Surgical saved with its clinic formula');
  await page.click('#tabs button[data-page="inpatient"]');
  await page.click('#page-inpatient [data-act="toggle"][data-id="U-PICU"]');
  console.log('Leave & Absence Coverage (Simple view)');
  const sres = () => text('#page-inpatient [data-region="sresult"][data-arg="U-PICU"]');
  const orRes = () => resOf('U-PICU');
  check((await sres()).includes('Coverage Adjustment') && (await sres()).includes('Not Applied'), 'result card: coverage not applied by default');
  check((await page.locator('#page-inpatient .simple-detail input[data-s="reliefFactor"]').count()) === 0, 'factor input hidden while unchecked');
  let o = await orRes();
  check(o.requiredFTE === o.baseRequiredFTE, 'unchecked: Final Required FTE = Base');
  for (const k of ['Base Required FTE', 'Final Required FTE', 'Available FTE', 'Gap', 'Overtime Needed']) check((await sres()).includes(k), `result card shows "${k}"`);
  await page.check('#page-inpatient .simple-detail input[data-s="applyReliefFactor"]');
  const fac = page.locator('#page-inpatient .simple-detail input[data-s="reliefFactor"]');
  check((await fac.count()) === 1 && (await fac.inputValue()) === '1.17', 'checked: factor input appears with 1.17');
  check(['1', '1.5', '0.01'].join() === [await fac.getAttribute('min'), await fac.getAttribute('max'), await fac.getAttribute('step')].join(), 'factor input limits 1.00–1.50, step 0.01');
  o = await orRes();
  check(Math.abs(o.requiredFTE - o.baseRequiredFTE * 1.17) < 1e-9 && (await sres()).includes('Coverage Factor') && (await sres()).includes('Coverage Addition'), 'checked: Final = Base × 1.17 with addition shown');
  await fac.fill('1.1');
  o = await orRes();
  check(Math.abs(o.requiredFTE - o.baseRequiredFTE * 1.1) < 1e-9, 'custom factor 1.10 applied immediately');
  const smA = await summary();
  check(Math.abs(smA.requiredFTE - (smA.baseRequiredFTE + smA.coverageAdditionFTE)) < 1e-9, 'summary: final = base + coverage addition (all units)');
  await page.click('#tabs button[data-page="other"]');
  check((await text('#page-other [data-region="mfinal"][data-arg="U-OR"]')).includes('= 28.60 with coverage'), 'Other & OPD: typed 26 × 1.10 shown as 28.60 with coverage');
  await page.click('#tabs button[data-page="settings"]');
  check(await page.locator('#page-settings input[data-s="applyReliefFactor"]').isChecked(), 'Simple settings show the same checkbox (checked)');
  check((await page.locator('#page-settings [data-s]').count()) === 10, 'Simple settings: 9 basic fields + factor input');
  await page.click('#btnSave'); await saved();
  const ss1 = gas.getAppData().state.settings;
  check(ss1.applyReliefFactor === true && ss1.reliefFactor === 1.1, 'checkbox and factor saved to the sheet');
  await page.uncheck('#page-settings input[data-s="applyReliefFactor"]');
  check(!(await page.evaluate(() => NwcApp.result.hours.applyReliefFactor)), 'uncheck applies immediately');
  await page.click('#btnReset'); await page.waitForSelector('#modalBg.open'); await page.click('#modalOk'); await saved();
  check(await page.evaluate(() => NwcApp.result.hours.applyReliefFactor && NwcApp.result.hours.reliefFactor == 1.1), 'Reset to Saved restores saved coverage (on, 1.10)');
  await page.setContent(renderIndex()); await page.waitForSelector('.hero');
  check(await page.evaluate(() => NwcApp.result.hours.applyReliefFactor === true && NwcApp.state.settings.reliefFactor === 1.1), 'coverage survives a page refresh');

  console.log('Edit, rename and delete units (Simple view)');
  await page.click('#tabs button[data-page="inpatient"]');
  await page.click('#page-inpatient [data-act="edit"][data-id="U-STROKE"]');
  await page.waitForSelector('#modalBg.open');
  check((await page.inputValue('#editName')) === 'Stroke Unit', 'edit dialog opens with the current name');
  await page.fill('#editName', 'ccu');
  await page.click('#modalOk');
  check(await page.evaluate(() => document.getElementById('modalBg').classList.contains('open')), 'duplicate name (CCU) is refused');
  await page.fill('#editName', '');
  await page.click('#modalOk');
  check(await page.evaluate(() => document.getElementById('modalBg').classList.contains('open')), 'empty name is refused');
  await page.fill('#editName', 'Stroke & Neuro Unit');
  await page.click('#modalOk');
  check((await text('#page-inpatient tr[data-row="U-STROKE"] td.name')).includes('Stroke & Neuro Unit'), 'rename applied in the table');
  await page.click('#page-inpatient [data-act="edit"][data-id="U-STROKE"]');
  await page.uncheck('#editOpen'); await page.click('#modalOk');
  check((await resOf('U-STROKE')).status === 'Closed' && (await resOf('U-STROKE')).requiredFTE === 0, 'closing a unit from the dialog: required 0');
  await page.click('#page-inpatient [data-act="edit"][data-id="U-STROKE"]');
  await page.check('#editOpen'); await page.click('#modalOk');
  await page.click('#tabs button[data-page="other"]');
  await page.click('#page-other [data-act="edit"][data-id="U-ENDO"]');
  await page.fill('#editName', 'Endoscopy Suite'); await page.click('#modalOk');
  check((await state()).units.find(u => u.id === 'U-ENDO').name === 'Endoscopy Suite', 'rename works on Other & OPD too');
  // Delete (soft) → restore → delete permanently
  await page.click('#page-other [data-act="edit"][data-id="U-ENDO"]');
  await page.click('#editDelete');
  await page.waitForSelector('#modalBg.open');
  check((await text('#modalTitle')) === 'Delete unit' && (await text('#modalBody')).includes('Endoscopy Suite'), 'delete asks for confirmation');
  await page.click('#modalCancel');
  check((await state()).units.find(u => u.id === 'U-ENDO').archived === false, 'cancel keeps the unit');
  await page.click('#page-other [data-act="edit"][data-id="U-ENDO"]'); await page.click('#editDelete'); await page.click('#modalOk');
  check((await page.locator('#page-other tr[data-row="U-ENDO"]').count()) === 0 && !(await summary()).provisionalReasons.some(x => x.includes('Endoscopy')), 'deleted unit leaves the table and the calculations');
  await page.click('#tabs button[data-page="settings"]');
  check((await text('#page-settings')).includes('Deleted units') && (await text('#page-settings')).includes('Endoscopy Suite'), 'Settings lists the deleted unit');
  await page.click('#page-settings [data-act="restore"][data-id="U-ENDO"]');
  check((await state()).units.find(u => u.id === 'U-ENDO').archived === false, 'Restore brings it back');
  // Permanent delete on the test's own unit (Day Surgery, no staff) so later checks keep the workbook data.
  const dsId = (await state()).units.find(u => u.name === 'Day Surgery').id;
  await page.click('#tabs button[data-page="other"]');
  await page.click(`#page-other [data-act="edit"][data-id="${dsId}"]`); await page.click('#editDelete'); await page.click('#modalOk');
  await page.evaluate(id => { NwcApp.state.contributions.push({ id: 'A-DS', category: 'CNC', staffRef: '', unitId: id, allocatedFTE: 1, contributionPct: 20, approved: true, countedInRNFTE: false, notes: '' }); }, dsId);
  await page.click('#tabs button[data-page="settings"]');
  await page.click(`#page-settings [data-act="purge"][data-id="${dsId}"]`);
  await page.waitForSelector('#modalBg.open');
  check((await text('#modalBody')).includes('1 CNC/PCA allocation'), 'permanent delete warns about linked allocations');
  await page.click('#modalOk');
  const st9 = await state();
  check(!st9.units.some(u => u.id === dsId) && !st9.contributions.some(c => c.unitId === dsId), 'unit and its allocations removed');
  await page.click('#btnSave'); await saved();
  const srv = gas.getAppData().state;
  check(!srv.units.some(u => u.id === dsId), 'permanent delete saved: unit gone from the Units sheet');
  check(srv.units.find(u => u.id === 'U-STROKE').name === 'Stroke & Neuro Unit' && srv.units.find(u => u.id === 'U-ENDO').name === 'Endoscopy Suite', 'renames saved');
  check(gas.__ss.sheets.Audit_Log.data.some(r => /units deleted permanently: Day Surgery/.test(r[3])), 'audit log records the permanent delete');

  console.log('Leave & Absence Coverage (Full view)');
  await page.click('[data-act="mode"][data-v="full"]');
  check(await page.evaluate(() => !document.body.classList.contains('simple')), 'Full view switch');
  await page.click('#tabs button[data-page="settings"]');
  check(await page.locator('#page-settings input[data-s="applyReliefFactor"]').isChecked(), 'Full settings show the checkbox (checked)');
  check((await page.locator('#page-settings input[data-s="fteMode"]').count()) === 0, 'legacy FTE-method radios removed');
  check((await text('[data-region="hours"]')).includes('applied × 1.1'), 'hours explanation reflects the factor');
  await page.click('#tabs button[data-page="inpatient"]');
  await page.click('#page-inpatient [data-act="toggle"][data-id="U-PICU"]');
  check(await page.locator('#page-inpatient .detail input[data-s="applyReliefFactor"]').isChecked(), 'Full unit panel shows the coverage control');
  check((await text('#page-inpatient [data-region="calc"][data-arg="U-PICU"]')).includes('Coverage adjustment: Factor 1.1'), 'Full calculation trail shows the adjustment');
  await page.uncheck('#page-inpatient .detail input[data-s="applyReliefFactor"]');
  check((await page.locator('#page-inpatient .detail input[data-s="reliefFactor"]').count()) === 0, 'Full view: factor hidden when unchecked');
  await page.click('#page-inpatient [data-act="toggle"][data-id="U-PICU"]');
  await page.click('#btnSave'); await saved();
  check(gas.getAppData().state.settings.applyReliefFactor === false, 'turning coverage off saves');
  await page.click('[data-act="mode"][data-v="simple"]');
  await page.click('[data-act="mode"][data-v="full"]');
  await page.click('#tabs button[data-page="summary"]');

  console.log('Summary dashboard');
  const kpiText = await text('[data-region="kpis"]');
  for (const k of ['Required FTE', 'Current RN FTE', 'CNC contribution', 'PCA/PCT contribution', 'Final planning shortage', 'Total headcount']) check(kpiText.includes(k), `card "${k}"`);
  check(kpiText.includes('481') && kpiText.includes('RN 392 · CNC 35 · PCA/PCT 54'), 'total headcount 481 with RN/CNC/PCA split');
  check(kpiText.includes('headcount 35') && kpiText.includes('headcount 54'), 'CNC/PCA headcount shown separately from credited contribution');
  check(kpiText.includes('Completed units only — provisional'), 'incomplete totals labelled "Completed units only — provisional"');
  check((await text('[data-region="scenario"]')).includes('Planning scenario'), 'adjusted gap labelled a planning scenario');
  check(await page.locator('.wf .track').count() === 6, 'gap waterfall has 6 steps');
  const ot = await text('[data-region="otcards"]');
  check(ot.includes('Uncovered hours') && ot.includes('Feasible overtime hours') && ot.includes('Estimated OT cost') && ot.includes('Remaining recruitment FTE'), 'overtime cards present');
  check(/Feasible overtime hours\s*Data Required/.test(ot), 'feasible OT = Data Required while eligibility is not set (not zero)');
  check((await page.locator('[data-region="checks"] .st-gap').count()) === 0, 'all reconciliation checks OK');
  await shot('1-summary');

  console.log('Inpatient: live recalculation from key inputs');
  await page.click('#tabs button[data-page="inpatient"]');
  const occ = page.locator('#page-inpatient tr[data-row="U-PICU"] input[data-f="params.RATIO.occupancyPct"]');
  const req = page.locator('#page-inpatient td[data-region="req"][data-arg="U-PICU"]');
  const before = await req.textContent();
  await occ.fill('90');
  check(before !== await req.textContent(), 'required FTE updates immediately');
  check(await occ.evaluate(el => document.activeElement === el), 'edited input keeps focus');
  check((await text('#savePill')) === 'Unsaved changes', 'unsaved indicator');
  await page.click('#btnSave'); await saved();
  check(gas.getAppData().state.units.find(u => u.id === 'U-PICU').params.RATIO.occupancyPct === 90, 'saved to sheet');

  console.log('Validation and reset');
  await occ.fill('150');
  check((await text('#banners')).includes('validation error'), 'error banner for occupancy 150%');
  await page.click('#btnSave');
  await page.waitForSelector('#modalBg.open');
  check((await text('#modalTitle')) === 'Cannot save', 'save refused');
  await page.click('#modalOk');
  await page.click('#btnReset'); await page.waitForSelector('#modalBg.open'); await page.click('#modalOk'); await saved();
  check(await page.locator('#page-inpatient tr[data-row="U-PICU"] input[data-f="params.RATIO.occupancyPct"]').inputValue() === '90', 'Reset to Saved restores 90');

  console.log('Details panel: CNC / PCA allocations');
  await page.click('#page-inpatient [data-act="toggle"][data-id="U-PICU"]');
  check(await page.locator('#page-inpatient .detail').count() === 1, 'details panel expands');
  const gapBefore = (await resOf('U-PICU')).adjustedGap;
  await page.click('#page-inpatient .detail [data-act="add-ct"][data-cat="CNC"]');
  let i = (await state()).contributions.length - 1;
  await page.fill(`#page-inpatient input[data-ct="${i}"][data-f="allocatedFTE"]`, '1');
  await page.fill(`#page-inpatient input[data-ct="${i}"][data-f="contributionPct"]`, '40');
  check((await text('#page-inpatient td[data-o="u|U-PICU|cncFTE"]')).includes('0.00'), 'CNC not credited until qualification confirmed');
  await page.check(`#page-inpatient input[data-ct="${i}"][data-f="approved"]`);
  check((await text('#page-inpatient td[data-o="u|U-PICU|cncFTE"]')).trim() === '0.40', 'CNC credited 1 × 40% = 0.40 FTE');
  await page.click('#page-inpatient .detail [data-act="add-ct"][data-cat="PCA"]');
  i = (await state()).contributions.length - 1;
  await page.fill(`#page-inpatient input[data-ct="${i}"][data-f="allocatedFTE"]`, '2');
  await page.check(`#page-inpatient input[data-ct="${i}"][data-f="approved"]`);
  check((await text('#page-inpatient td[data-o="u|U-PICU|pcaFTE"]')).trim() === '0.50', 'PCA/PCT credited 2 × 25% default = 0.50 FTE');
  const r1 = await resOf('U-PICU');
  check(Math.abs(r1.adjustedGap - (gapBefore - 0.9)) < 1e-9, 'remaining gap reduced by 0.90 (CNC 0.40 + PCA 0.50)');
  check(Math.abs(r1.rnGap - (gapBefore - 0.4)) < 1e-9, 'RN coverage gap excludes PCA/PCT');
  await page.click(`#page-inpatient [data-act="add-ct"][data-cat="PCA"]`);
  const dup = (await state()).contributions.length - 1;
  await page.fill(`#page-inpatient input[data-ct="${dup}"][data-f="allocatedFTE"]`, '1');
  check((await text('#banners')).includes('duplicate allocation'), 'duplicate allocation flagged');
  await page.click(`#page-inpatient [data-act="del-ct"][data-i="${dup}"]`); await page.click('#modalOk');
  check(!(await text('#banners')).includes('duplicate allocation'), 'duplicate removed after confirmation');
  const basisTxt = await text('#page-inpatient [data-region="basis"][data-arg="U-PICU"]');
  check(basisTxt.includes('Average workload') && basisTxt.includes('Whole-shift staffing') && basisTxt.includes('drives requirement'), 'average vs whole-shift FTE shown with the driving basis');
  await shot('2-inpatient-details');

  console.log('Estimated overtime view');
  await page.click('#page-inpatient [data-act="view"][data-v="ot"]');
  check((await text('#page-inpatient thead')).includes('Feasible OT hours'), 'overtime columns shown');
  check((await text('#page-inpatient td[data-o="u|U-W3-NS1|feasibleOT"]')).includes('Data Required'), 'short unit without eligibility → Data Required');
  await page.fill('#page-inpatient tr[data-row="U-W3-NS1"] input[data-f="otEligibleHeadcount"]', '1');
  check((await text('#page-inpatient td[data-o="u|U-W3-NS1|feasibleOT"]')).trim() === '48', 'unit override: 1 RN × 48 h default');
  check((await text('#page-inpatient td[data-o="u|U-W3-NS1|otCost"]')).includes('Rate Required'), 'OT cost shows Rate Required');
  const w3 = await resOf('U-W3-NS1');
  check(w3.remainingUncoveredHours > 0 && Math.abs(w3.remainingRecruitFTE * (await page.evaluate(() => NwcApp.result.hours.productiveHoursPerFTE)) - w3.remainingUncoveredHours) < 1e-6, 'insufficient OT capacity → remaining recruitment FTE');
  await shot('3-inpatient-ot');

  console.log('Other & OPD: restricted methods, no reinterpretation');
  await page.click('#tabs button[data-page="other"]');
  await page.click('#page-other [data-act="toggle"][data-id="U-OPD-MED"]');
  const opts = await page.locator('#page-other tr[data-row="U-OPD-MED"] + tr.detail-row select[data-f="method"] option').allTextContents();
  check(opts.length === 3 && opts[0].startsWith('Required FTE entered manually') && opts[1].startsWith('Clinic-based') && opts[2].startsWith('Patient-volume'), 'OPD offers manual, clinic-based or patient-volume only');
  await page.selectOption('#page-other tr[data-row="U-OPD-MED"] + tr.detail-row select[data-f="method"]', 'ACTIVITY');
  check((await resOf('U-OPD-MED')).status === 'Data Required', 'switching to patient volume does not reinterpret clinic inputs');
  await page.selectOption('#page-other tr[data-row="U-OPD-MED"] + tr.detail-row select[data-f="method"]', 'CLINIC');
  check((await resOf('U-OPD-MED')).status !== 'Data Required', 'switching back restores clinic inputs');
  await page.click('[data-act="add-unit"][data-sec="OTHER"]');
  await page.fill('#newUnitName', 'Dialysis');
  await page.selectOption('#newUnitType', 'OTHER');
  const newOpts = await page.locator('#newUnitMethod option').allTextContents();
  check(newOpts.length === 3 && newOpts[0].startsWith('Required FTE entered manually') && newOpts.some(o => o.startsWith('Fixed RN posts')), 'Full view Add Unit: methods follow the chosen unit type');
  await page.selectOption('#newUnitMethod', 'ACTIVITY');
  await page.click('#modalOk');
  const dId = (await state()).units.find(u => u.name === 'Dialysis').id;
  check((await resOf(dId)).status === 'Data Required', 'new unit without data → Data Required');
  await page.click('#page-other [data-act="toggle"][data-id="U-CATH"]');
  await page.click('[data-act="archive"][data-id="U-CATH"]');
  await page.waitForSelector('#modalBg.open');
  check((await text('#modalBody')).includes('Cathlab'), 'archive asks for confirmation');
  await page.click('#modalOk');
  check((await state()).units.find(u => u.id === 'U-CATH').archived === true, 'Cathlab archived');
  await shot('4-other');

  console.log('Settings: basis, eligibility, rates, approval, pool limits');
  await page.click('#tabs button[data-page="settings"]');
  const reqAvg = (await summary()).requiredFTE;
  await page.selectOption('select[data-s="requirementBasis"]', 'WHOLE_SHIFT');
  check((await summary()).requiredFTE > reqAvg, 'whole-shift basis raises required FTE');
  await page.selectOption('select[data-s="requirementBasis"]', 'AVERAGE');
  await page.fill('input[data-s="otEligiblePct"]', '80');
  check((await summary()).feasibleOTHours !== null, 'global eligibility enables feasible OT totals');
  await page.fill('input[data-s="costOTPerHour"]', '100');
  const sm = await summary();
  check(Math.abs(sm.otCost - sm.feasibleOTHours * 100) < 1e-6, 'estimated OT cost = feasible hours × rate');
  await page.fill('input[data-s="cncFTE"]', '0.5');
  check((await text('#banners')).includes('more than the 0.5 FTE available'), 'CNC allocations above available FTE blocked');
  await page.fill('input[data-s="cncFTE"]', '35');
  check((await text('[data-region="pools"]')).includes('Unallocated'), 'pool table shows allocated vs unallocated');
  await page.selectOption('select[data-s="pcaAssumptionsApproved"]', 'YES');
  await page.click('[data-act="restore"][data-id="U-CATH"]');
  await shot('5-settings');

  console.log('Summary after changes');
  await page.click('#tabs button[data-page="summary"]');
  check((await text('[data-region="scenario"]')).trim() === '', 'scenario banner removed once assumptions approved');
  const wf = (await summary()).waterfall;
  check(wf.find(x => x.key === 'cnc').value < 0 && wf.find(x => x.key === 'pca').value < 0, 'waterfall shows CNC and PCA reductions');
  await page.click('[data-act="add-transfer"]');
  await page.selectOption('select[data-tr="0"][data-f="sourceUnitId"]', 'U-OPD-MED');
  await page.selectOption('select[data-tr="0"][data-f="destUnitId"]', 'U-W3-NS1');
  await page.fill('input[data-tr="0"][data-f="fte"]', '2');
  check((await text('td[data-region="transfer"][data-arg="0"]')).includes('Not counted'), 'unconfirmed transfer not counted');
  await page.check('input[data-tr="0"][data-f="competencyConfirmed"]');
  await page.check('input[data-tr="0"][data-f="coverageCompatible"]');
  check((await text('td[data-region="transfer"][data-arg="0"]')).includes('Counted'), 'confirmed compatible transfer counted');
  check((await summary()).waterfall.find(x => x.key === 'transfer').value < 0, 'transfer step reduces shortage');
  check((await page.locator('[data-region="checks"] .st-gap').count()) === 0, 'reconciliation still OK');
  await page.click('#btnSave'); await saved();
  const st = gas.getAppData().state;
  check(st.contributions.length === 2 && st.transfers.length === 1 && st.settings.otEligiblePct === 80 && !st.units.find(u => u.id === 'U-CATH').archived, 'allocations, transfer, settings, restore persisted');
  const server = gas.NwcCalc.calculate(st).summary, client = await summary();
  check(Math.abs(server.finalShortageFTE - client.finalShortageFTE) < 1e-12 && Math.abs(server.feasibleOTHours - client.feasibleOTHours) < 1e-12, 'server and browser results identical after save');
  await shot('6-summary-after');

  console.log('Responsive layout');
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `no horizontal page scroll at ${w}px`);
    const cardsFit = await page.evaluate(() => Array.from(document.querySelectorAll('.kpi')).every(c => c.getBoundingClientRect().right <= window.innerWidth + 1));
    check(cardsFit, `KPI cards wrap inside the viewport at ${w}px`);
  }
  for (const mode of ['simple', 'full']) {
    await page.click(`[data-act="mode"][data-v="${mode}"]`);
    for (const pg of ['summary', 'inpatient', 'other', 'settings']) {
      await page.click(`#tabs button[data-page="${pg}"]`);
      check(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, `${mode} ${pg}: no horizontal page scroll at 390px`);
    }
  }
  await page.click('#tabs button[data-page="summary"]');
  await shot('7-summary-mobile');

  check(pageErrors.length === 0, 'no browser console errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
  await browser.close();
  console.log(`UI end-to-end test passed (${count} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
