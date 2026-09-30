/**
 * Builds a single-file, offline version of the calculator:
 *   node scripts/build-standalone.cjs  →  standalone/nursing-workforce-calculator.html
 *
 * It bundles the real UI (Index/Styles/Scripts.html), the shared engine (Calculations.gs)
 * and the workbook seed (Config.gs). Code.gs / Google Sheets are replaced by a small
 * in-browser backend that stores data in localStorage, with JSON export/import for backups.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'apps-script');
const OUT = path.join(__dirname, '..', 'standalone', 'nursing-workforce-calculator.html');
const read = n => fs.readFileSync(path.join(ROOT, n), 'utf8');

const idx = read('Index.html');
const open = '<body class="simple">';
const bodyInner = idx.slice(idx.indexOf(open) + open.length, idx.indexOf('<script><?!= engineSource ?></script>'));
const header = bodyInner.slice(0, bodyInner.indexOf('<div id="banners">'));
const rest = bodyInner.slice(bodyInner.indexOf('<div id="banners">'));
const styles = read('Styles.html').replace(/^\s*<style>/, '').replace(/<\/style>\s*$/, '');
const scripts = read('Scripts.html').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');

const backend = `
/* Offline backend: replaces Code.gs. Same engine; data kept in this browser (localStorage). */
(function () {
  var KEY = 'nwcStandalone.v1';
  function month() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function seed() {
    var s = NwcCalc.defaultSettings(); s.reportingMonth = month();
    var st = { settings: s, units: getSeedUnits_(), transfers: [], contributions: [] };
    NwcCalc.convertOtherToManual(st);
    return { state: st, revision: 1, savedAt: '' };
  }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* storage unavailable */ }
    return seed();
  }
  var db = load();
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { return false; }
  }
  var api = {
    getAppData: function () { return JSON.parse(JSON.stringify({ state: db.state, revision: db.revision, savedAt: db.savedAt, savedBy: '', user: '', engineVersion: NwcCalc.VERSION })); },
    saveAppData: function (payload) {
      if (!payload || payload.revision !== db.revision) return { ok: false, conflict: true, errors: ['The data changed in another tab. Use Reset to Saved.'] };
      var st = JSON.parse(JSON.stringify(payload.state));
      var errs = NwcCalc.calculate(st).issues.filter(function (x) { return x.level === 'error'; });
      if (errs.length) return { ok: false, errors: errs.map(function (x) { return x.scope + ': ' + x.message; }) };
      db = { state: st, revision: db.revision + 1, savedAt: new Date().toISOString() };
      if (!persist()) return { ok: false, errors: ['This browser blocked saving (private window or storage disabled). Use Export data to keep a copy.'] };
      return { ok: true, data: api.getAppData(), warnings: 0 };
    }
  };
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, k) {
      if (k === 'withSuccessHandler') return function (h) { return runner(h, fail); };
      if (k === 'withFailureHandler') return function (h) { return runner(ok, h); };
      return function () {
        var args = arguments;
        setTimeout(function () { try { var r = api[k].apply(null, args); if (ok) ok(r); } catch (e) { if (fail) fail(e); } }, 30);
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
  window.nwcOffline = {
    exportJson: function () {
      var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'nursing-workforce-data-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
    },
    importJson: function (text) {
      var d = JSON.parse(text);
      if (!d || !d.state || !Array.isArray(d.state.units)) throw new Error('This file is not a calculator backup.');
      db = { state: d.state, revision: (db.revision || 1) + 1, savedAt: new Date().toISOString() };
      persist(); location.reload();
    },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } location.reload(); }
  };
})();
document.body.classList.add('simple');
`;

const ribbon = `
<div class="offline-ribbon" role="note">
  <span><b>Offline version.</b> Data is saved in this browser on this computer. Use <b>Export data</b> to keep a backup or move it to another computer.</span>
  <span class="or-actions" id="orActions">
    <button type="button" class="small" id="orExport">Export data</button>
    <label class="small btnlike">Import data<input type="file" id="orImport" accept="application/json,.json" hidden></label>
    <button type="button" class="small" id="orReset">Start over</button>
  </span>
</div>
<script>
(function () {
  var box = document.getElementById('orActions');
  var base = box.innerHTML;
  box.addEventListener('click', function (e) {
    var id = e.target.id;
    if (id === 'orExport') window.nwcOffline.exportJson();
    else if (id === 'orReset') box.innerHTML = 'Delete all your data and restore the workbook example? <button type="button" class="small danger" id="orYes">Delete and restart</button> <button type="button" class="small" id="orNo">Cancel</button>';
    else if (id === 'orYes') window.nwcOffline.reset();
    else if (id === 'orNo') box.innerHTML = base;
  });
  box.addEventListener('change', function (e) {
    if (e.target.id !== 'orImport' || !e.target.files[0]) return;
    var r = new FileReader();
    r.onload = function () { try { window.nwcOffline.importJson(r.result); } catch (err) { alert(err.message); } };
    r.readAsText(e.target.files[0]);
  });
})();
</script>`;

const extraCss = `
  .offline-ribbon { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; max-width: 1480px; margin: 12px auto 0; padding: 8px 14px; border-radius: 8px; background: var(--navy-50); color: var(--navy); border: 1px solid var(--line); font-size: 13px; }
  .offline-ribbon .or-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .btnlike { font: inherit; cursor: pointer; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 4px 10px; font-size: 13px; color: var(--ink); }
  @media (max-width: 1528px) { .offline-ribbon { margin-left: 24px; margin-right: 24px; } }
  @media (max-width: 700px) { .offline-ribbon { margin-left: 16px; margin-right: 16px; } }
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nursing Workforce Calculator</title>
<!-- Generated by scripts/build-standalone.cjs from apps-script/. Do not edit by hand. -->
<style>
${styles}
${extraCss}
</style>
</head>
<body class="simple">
${header}${ribbon}
${rest}
<script>
${read('Calculations.gs')}
${read('Config.gs')}
${backend}
</script>
<script>
${scripts}
</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('Wrote ' + path.relative(process.cwd(), OUT) + ' (' + Math.round(html.length / 1024) + ' KB)');
