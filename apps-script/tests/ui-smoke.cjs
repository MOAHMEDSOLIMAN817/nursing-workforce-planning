/**
 * End-to-end UI smoke test (not part of `npm test`; needs Playwright + Chromium).
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

function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓ ' + msg); }

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.exposeFunction('__gas', (fn, argsJson) => JSON.stringify(gas[fn].apply(null, JSON.parse(argsJson))));
  await page.setContent(renderIndex());
  await page.waitForSelector('.cards');
  const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: true }); };

  console.log('Summary');
  const cards = await page.textContent('.cards');
  check(cards.includes('392'), 'current RN headcount 392 shown');
  check(cards.includes('481'), 'total workforce 481 (392 RN + 54 PCA/PCT + 35 CNC)');
  check((await page.textContent('#banners')).includes('Provisional'), 'provisional banner shown (Data Required units)');
  await shot('1-summary');

  console.log('Inpatient: live recalculation');
  await page.click('#tabs button[data-page="inpatient"]');
  const occ = page.locator('#page-inpatient tbody input[data-u="U-PICU"][data-f="params.RATIO.occupancyPct"]').first();
  const reqCell = page.locator('#page-inpatient td[data-o="u|U-PICU|requiredFTE"]');
  const before = await reqCell.textContent();
  await occ.fill('90');
  const after = await reqCell.textContent();
  check(before !== after, `required FTE updates immediately (${before} → ${after})`);
  check((await page.textContent('#savePill')) === 'Unsaved changes', 'unsaved indicator shown');
  check(await occ.evaluate(el => document.activeElement === el), 'edited input keeps focus');
  await shot('2-inpatient');

  console.log('Save');
  await page.click('#btnSave');
  await page.waitForFunction(() => document.getElementById('savePill').textContent === 'All changes saved');
  check(gas.getAppData().state.units.find(u => u.id === 'U-PICU').params.RATIO.occupancyPct === 90, 'saved to sheet (occupancy 90)');

  console.log('Validation blocks save');
  await page.locator('#page-inpatient tbody input[data-u="U-PICU"][data-f="params.RATIO.occupancyPct"]').first().fill('150');
  check((await page.textContent('#banners')).includes('validation error'), 'error banner for occupancy 150%');
  check(await page.locator('#page-inpatient tbody input[data-u="U-PICU"][data-f="params.RATIO.occupancyPct"]').first().evaluate(el => el.classList.contains('bad')), 'invalid cell highlighted');
  await page.click('#btnSave');
  await page.waitForSelector('#modalBg.open');
  check((await page.textContent('#modalTitle')) === 'Cannot save', 'save refused client-side');
  await page.click('#modalOk');

  console.log('Reset to Saved (confirmed)');
  await page.click('#btnReset');
  await page.waitForSelector('#modalBg.open');
  await page.click('#modalOk');
  await page.waitForFunction(() => document.getElementById('savePill').textContent === 'All changes saved');
  check(await page.locator('#page-inpatient tbody input[data-u="U-PICU"][data-f="params.RATIO.occupancyPct"]').first().inputValue() === '90', 'value restored to saved 90');

  console.log('Other & OPD: add unit, method details, archive');
  await page.click('#tabs button[data-page="other"]');
  await page.click('[data-act="add-unit"][data-sec="OTHER"]');
  await page.fill('#newUnitName', 'Dialysis');
  await page.selectOption('#newUnitMethod', 'ACTIVITY');
  await page.click('#modalOk');
  const newRow = page.locator('#page-other tr', { hasText: 'Dialysis' }).first();
  check(await page.locator('#page-other input.name').evaluateAll(els => els.some(e => e.value === 'Dialysis')), 'new unit row added');
  check((await page.textContent('#page-other .detail')).includes('OPD B: activity-based'), 'detail panel shows the method inputs');
  const id = await page.evaluate(() => NwcApp.sel.OTHER);
  check(/Data Required/.test(await page.textContent(`#page-other td[data-o="u|${id}|status"]`)), 'new unit without data shows Data Required');
  await page.fill(`input[data-u="${id}"][data-f="params.ACTIVITY.activitiesPerMonth"]`, '1200');
  await page.fill(`input[data-u="${id}"][data-f="params.ACTIVITY.minutesPerActivity"]`, '30');
  await page.fill(`#page-other .detail input[data-u="${id}"][data-f="schedule.weekdayHours"]`, '10');
  await page.fill(`#page-other .detail input[data-u="${id}"][data-f="schedule.fridayHours"]`, '0');
  check(/Coverage Gap/.test(await page.textContent(`#page-other td[data-o="u|${id}|status"]`)), 'activity-based unit calculates (Coverage Gap with 0 RN)');
  await shot('3-other');

  // OR: switch to "already included" flags, fill data -> calculated.
  await page.click('[data-act="select"][data-id="U-OR"]');
  for (const [f, v] of [['params.OR.rnPerRoom', '2'], ['minRNPerShift', '1']]) await page.locator(`#page-other .detail input[data-u="U-OR"][data-f="${f}"]`).first().fill(v);
  await page.fill('#page-other .detail input[data-u="U-OR"][data-f="schedule.weekdayHours"]', '10');
  await page.fill('#page-other .detail input[data-u="U-OR"][data-f="schedule.fridayHours"]', '0');
  for (const f of ['prepIncluded', 'recoveryIncluded', 'emergencyIncluded']) await page.check(`#page-other .detail input[data-u="U-OR"][data-f="params.OR.${f}"]`);
  check(!/Data Required/.test(await page.textContent('#page-other td[data-o="u|U-OR|status"]')), 'OR calculates from rooms × hours × roles');

  await page.click(`[data-act="select"][data-id="U-CATH"]`);
  await page.click('[data-act="archive"][data-id="U-CATH"]');
  await page.waitForSelector('#modalBg.open');
  check((await page.textContent('#modalBody')).includes('Cathlab'), 'archive asks for confirmation');
  await page.click('#modalOk');
  check(!(await page.locator('#page-other input.name').evaluateAll(els => els.some(e => e.value === 'Cathlab'))), 'archived unit removed from table');

  console.log('Settings: FTE mode switch and archived list');
  await page.click('#tabs button[data-page="settings"]');
  const hpf1 = await page.textContent('#monthPill');
  await page.check('input[name="fteMode"][value="UPLIFT"]');
  const hpf2 = await page.textContent('#monthPill');
  check(hpf1 !== hpf2, `hours per FTE changes with mode (${hpf1.split('·').pop().trim()} → ${hpf2.split('·').pop().trim()})`);
  check((await page.textContent('#page-settings')).includes('Cathlab'), 'archived unit listed with Restore');
  await page.check('input[name="fteMode"][value="DEDUCT"]');
  await page.fill('input[data-s="otMaxHoursPerRN"]', '12');
  await shot('4-settings');

  console.log('Summary: transfers');
  await page.click('#tabs button[data-page="summary"]');
  await page.click('[data-act="add-transfer"]');
  await page.selectOption('select[data-tr="0"][data-f="sourceUnitId"]', 'U-OPD-MED');
  await page.selectOption('select[data-tr="0"][data-f="destUnitId"]', 'U-W3-NS1');
  await page.fill('input[data-tr="0"][data-f="fte"]', '3');
  check((await page.textContent('td[data-region="transfer"][data-arg="0"]')).includes('Not counted'), 'unconfirmed transfer not counted');
  await page.check('input[data-tr="0"][data-f="competencyConfirmed"]');
  await page.check('input[data-tr="0"][data-f="coverageCompatible"]');
  check((await page.textContent('td[data-region="transfer"][data-arg="0"]')).includes('Counted'), 'confirmed compatible transfer counted');
  check((await page.textContent('.cards')).includes('3.00'), 'confirmed transfers card shows 3.00 FTE');
  const checksOk = await page.locator('[data-region="checks"] .st-gap').count();
  check(checksOk === 0, 'all reconciliation checks OK');
  await page.click('#btnSave');
  await page.waitForFunction(() => document.getElementById('savePill').textContent === 'All changes saved');
  const saved = gas.getAppData().state;
  check(saved.transfers.length === 1 && saved.units.find(u => u.id === 'U-CATH').archived === true, 'transfer and archive persisted');
  await shot('5-summary-after');

  console.log('Inpatient: acuity groups');
  await page.click('#tabs button[data-page="inpatient"]');
  await page.selectOption('#page-inpatient tbody select[data-u="U-CCU"][data-f="method"]', 'ACUITY');
  await page.click('[data-act="select"][data-id="U-CCU"]');
  check(/Data Required/.test(await page.textContent('#page-inpatient td[data-o="u|U-CCU|status"]')), 'acuity mode without groups is Data Required');
  for (const [name, pts, ratio] of [['Ventilated', '2', '1'], ['Standard', '2', '2']]) {
    await page.click('[data-act="add-row"][data-id="U-CCU"][data-tk="groups"]');
    const i = await page.evaluate(() => NwcApp.state.units.find(u => u.id === 'U-CCU').params.ACUITY.groups.length - 1);
    await page.fill(`input[data-u="U-CCU"][data-f="params.ACUITY.groups.${i}.name"]`, name);
    await page.fill(`input[data-u="U-CCU"][data-f="params.ACUITY.groups.${i}.patients"]`, pts);
    await page.fill(`input[data-u="U-CCU"][data-f="params.ACUITY.groups.${i}.patientsPerRN"]`, ratio);
  }
  check((await page.textContent('#page-inpatient td[data-o="u|U-CCU|avgConcurrentRN"]')).trim() === '3', 'acuity groups: 2÷1 + 2÷2 = 3 RN');
  await page.fill('input[data-u="U-CCU"][data-f="params.ACUITY.groups.1.name"]', 'ventilated');
  check((await page.textContent('#banners')).includes('mutually exclusive'), 'overlapping group names flagged');
  await page.fill('input[data-u="U-CCU"][data-f="params.ACUITY.groups.1.name"]', 'Standard');

  console.log('Duplicate unit name blocked');
  await page.fill('#page-inpatient tbody input[data-u="U-STROKE"][data-f="name"]', 'ccu');
  check((await page.textContent('#banners')).includes('Duplicate unit name'), 'duplicate name error shown');
  await page.fill('#page-inpatient tbody input[data-u="U-STROKE"][data-f="name"]', 'Stroke Unit');

  console.log('ER: period/acuity rows with confirmed removal');
  await page.click('#tabs button[data-page="other"]');
  await page.click('[data-act="select"][data-id="U-ER"]');
  const erRows = () => page.evaluate(() => NwcApp.state.units.find(u => u.id === 'U-ER').params.ER.workload.length);
  const n0 = await erRows();
  await page.click('[data-act="del-row"][data-id="U-ER"][data-tk="workload"][data-i="0"]');
  await page.click('#modalCancel');
  check(await erRows() === n0, 'cancelling removal keeps the row');
  await page.click('[data-act="del-row"][data-id="U-ER"][data-tk="workload"][data-i="0"]');
  await page.click('#modalOk');
  check(await erRows() === n0 - 1, 'confirmed removal deletes the row');

  console.log('Settings: CNC contribution and restore');
  await page.click('#tabs button[data-page="settings"]');
  await page.click('[data-act="add-cnc"]');
  await page.fill('input[data-cnc="0"][data-f="cncRef"]', 'CNC-01');
  await page.selectOption('select[data-cnc="0"][data-f="unitId"]', 'U-W3-NS1');
  await page.fill('input[data-cnc="0"][data-f="totalHours"]', '175');
  await page.fill('input[data-cnc="0"][data-f="adminHours"]', '100');
  await page.fill('input[data-cnc="0"][data-f="directCareHours"]', '60');
  check((await page.textContent('td[data-region="cnc"][data-arg="0"]')).includes('Not credited'), 'CNC not credited until qualification confirmed');
  await page.check('input[data-cnc="0"][data-f="qualified"]');
  check((await page.textContent('td[data-region="cnc"][data-arg="0"]')).includes('60 h'), 'qualified CNC credited 60 direct-care hours');
  await page.fill('input[data-cnc="0"][data-f="adminHours"]', '130');
  check((await page.textContent('#banners')).includes('exceed total hours'), 'direct + admin > total flagged');
  await page.fill('input[data-cnc="0"][data-f="adminHours"]', '100');
  await page.click('[data-act="restore"][data-id="U-CATH"]');
  check(await page.evaluate(() => NwcApp.state.units.find(u => u.id === 'U-CATH').archived === false), 'archived unit restored');
  await page.click('#btnSave');
  await page.waitForFunction(() => document.getElementById('savePill').textContent === 'All changes saved');
  const st2 = gas.getAppData().state;
  check(st2.cncContributions.length === 1 && st2.units.find(u => u.id === 'U-CCU').method === 'ACUITY' && !st2.units.find(u => u.id === 'U-CATH').archived,
    'CNC row, acuity groups and restore persisted');
  const w = gas.NwcCalc.calculate(st2).units.find(u => u.id === 'U-W3-NS1');
  check(w.cncFTE > 0 && w.currentHC === 1, 'CNC adds FTE credit to the unit, not RN headcount');

  console.log('Phone-width layout');
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, 'no horizontal page scroll at 390px (tables scroll inside their frame)');

  check(pageErrors.length === 0, 'no browser console errors' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
  await browser.close();
  console.log('UI smoke test passed');
})().catch(async e => { console.error(e); process.exit(1); });
