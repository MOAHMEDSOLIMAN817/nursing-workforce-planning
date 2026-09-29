/**
 * Code.gs — web app entry points, load/save API and the sheet menu.
 *
 * The browser and the server use the same engine (Calculations.gs). Every save
 * is sanitised, re-calculated and re-validated here; any validation error
 * blocks the save.
 */

function doGet() {
  ensureInitialized_();
  var t = HtmlService.createTemplateFromFile('Index');
  t.engineSource = getEngineSource_();
  return t.evaluate()
    .setTitle(APP_CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Nursing Workforce')
    .addItem('Open calculator', 'openCalculatorDialog')
    .addItem('Initialise / repair sheets', 'menuInitialize_')
    .addItem('Refresh Results sheet', 'refreshResultsSheet')
    .addToUi();
}

function openCalculatorDialog() {
  ensureInitialized_();
  var t = HtmlService.createTemplateFromFile('Index');
  t.engineSource = getEngineSource_();
  var html = t.evaluate().setWidth(1400).setHeight(900);
  SpreadsheetApp.getUi().showModelessDialog(html, APP_CONFIG.APP_TITLE);
}

function menuInitialize_() {
  var msg = initializeSystem();
  SpreadsheetApp.getUi().alert(msg);
}

/** Used by Index.html: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** The exact engine source, injected into the page so client and server share it. */
function getEngineSource_() {
  return 'var NwcCalc = (' + NWC_ENGINE_FACTORY_.toString() + ')();';
}

/** Returns everything the UI needs. */
function getAppData() {
  ensureInitialized_();
  var meta = readMeta_();
  var user = '';
  try { user = Session.getActiveUser().getEmail(); } catch (e) { user = ''; }
  return {
    state: {
      settings: readSettings_(),
      units: readUnits_(),
      transfers: readTransfers_(),
      cncContributions: readCnc_()
    },
    revision: Number(meta.revision || 1),
    savedAt: meta.saved_at || '',
    savedBy: meta.saved_by || '',
    user: user,
    engineVersion: NwcCalc.VERSION
  };
}

/**
 * Saves the full state. payload = { state, revision }.
 * Returns { ok: true, data } or { ok: false, errors: [...], conflict? }.
 */
function saveAppData(payload) {
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, errors: ['Another save is in progress. Try again in a moment.'] };
  try {
    ensureInitialized_();
    var meta = readMeta_();
    var current = Number(meta.revision || 1);
    if (!payload || Number(payload.revision) !== current) {
      return { ok: false, conflict: true, errors: ['The data was saved by someone else since you loaded it (revision ' + current + '). Use "Reset to Saved" to reload, then re-apply your changes.'] };
    }
    var existingUnits = readUnits_();
    var clean = sanitizeState_(payload.state || {}, existingUnits);
    if (clean.errors.length) return { ok: false, errors: clean.errors };
    var state = clean.state;

    var result = NwcCalc.calculate(state);
    var errors = result.issues.filter(function (x) { return x.level === 'error'; });
    if (errors.length) {
      return { ok: false, errors: errors.map(function (x) { return x.scope + ': ' + x.message; }) };
    }

    var user = '';
    try { user = Session.getActiveUser().getEmail(); } catch (e) { user = ''; }
    var prevById = {};
    existingUnits.forEach(function (u) { prevById[u.id] = JSON.stringify(stripMeta_(u)); });
    var changed = {}, changedNames = [];
    state.units.forEach(function (u) {
      if (prevById[u.id] !== JSON.stringify(stripMeta_(u))) { changed[u.id] = true; changedNames.push(u.name); }
    });

    writeSettings_(state.settings);
    writeUnits_(state.units, user, changed);
    writeTransfers_(state.transfers);
    writeCnc_(state.cncContributions);
    writeResultsSheet_(result);

    var rev = current + 1;
    setMeta_('revision', String(rev));
    setMeta_('saved_at', new Date().toISOString());
    setMeta_('saved_by', user);
    appendAudit_('save', 'rev ' + rev + '; units changed: ' + (changedNames.join(', ') || 'none') +
      '; transfers: ' + state.transfers.length + '; CNC rows: ' + state.cncContributions.length +
      '; required RN FTE ' + result.summary.requiredRNFTE + (result.summary.provisional ? ' (provisional)' : ''));
    return { ok: true, data: getAppData(), warnings: result.issues.filter(function (x) { return x.level === 'warning'; }).length };
  } finally {
    lock.releaseLock();
  }
}

function stripMeta_(u) {
  var c = JSON.parse(JSON.stringify(u));
  delete c.updatedAt;
  return c;
}

/** Refresh the derived Results sheet from saved data (menu action). */
function refreshResultsSheet() {
  var data = getAppData();
  writeResultsSheet_(NwcCalc.calculate(data.state));
  return 'Results refreshed';
}

// -----------------------------------------------------------------------------
// Sanitising: coerce types, drop unknown keys, never lose a saved unit.
// -----------------------------------------------------------------------------
var ID_RE_ = /^[A-Za-z0-9_\-]{1,64}$/;

function sNum_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isFinite(n) ? n : String(v); // keep invalid text so validation reports it
}
function sStr_(v, max) { return v === null || v === undefined ? '' : String(v).slice(0, max || 500); }
function sBool_(v) { return v === true || v === 'TRUE' || v === 'true'; }

function sanitizeParams_(params) {
  var out = {};
  Object.keys(NwcCalc.METHODS).forEach(function (m) {
    var p = params && params[m];
    if (!p || typeof p !== 'object') return;
    var def = NwcCalc.METHODS[m], o = {};
    def.fields.forEach(function (f) { o[f.key] = f.type === 'bool' ? sBool_(p[f.key]) : f.type === 'text' ? sStr_(p[f.key]) : sNum_(p[f.key]); });
    Object.keys(def.tables || {}).forEach(function (tk) {
      o[tk] = (Array.isArray(p[tk]) ? p[tk] : []).slice(0, 100).map(function (row) {
        var r = {};
        def.tables[tk].columns.forEach(function (c) { r[c.key] = c.type === 'text' ? sStr_(row && row[c.key], 120) : sNum_(row && row[c.key]); });
        return r;
      });
    });
    out[m] = o;
  });
  return out;
}

function sanitizeState_(input, existingUnits) {
  var errors = [];
  var settings = {};
  NwcCalc.SETTINGS_FIELDS.forEach(function (f) {
    var v = input.settings ? input.settings[f.key] : undefined;
    if (v === undefined) v = f.def;
    settings[f.key] = f.type === 'number' ? sNum_(v) : sStr_(v, 40);
  });

  var seen = {};
  var units = (Array.isArray(input.units) ? input.units : []).slice(0, 300).map(function (u) {
    var id = sStr_(u.id, 64);
    if (!ID_RE_.test(id)) errors.push('Invalid unit ID "' + id + '".');
    if (seen[id]) errors.push('Duplicate unit ID ' + id + '.');
    seen[id] = true;
    var sch = u.schedule || {}, rel = u.relation || {};
    return {
      id: id, name: sStr_(u.name, 120).trim(), section: u.section === 'INPATIENT' ? 'INPATIENT' : 'OTHER',
      method: NwcCalc.METHODS[u.method] ? u.method : sStr_(u.method, 20), isOpen: u.isOpen !== false, archived: sBool_(u.archived),
      sortOrder: sNum_(u.sortOrder),
      currentRNHeadcount: sNum_(u.currentRNHeadcount), currentRNFTE: sNum_(u.currentRNFTE), minRNPerShift: sNum_(u.minRNPerShift),
      schedule: { weekdayHours: sNum_(sch.weekdayHours), openDays: sStr_(sch.openDays, 60), fridayHours: sNum_(sch.fridayHours), holidayHours: sNum_(sch.holidayHours) },
      manualOverrideFTE: sNum_(u.manualOverrideFTE), manualOverrideReason: sStr_(u.manualOverrideReason, 500).trim(),
      relation: { type: NwcCalc.RELATION_TYPES.indexOf(rel.type) >= 0 ? rel.type : '', unitId: sStr_(rel.unitId, 64),
        resolution: NwcCalc.RELATION_RESOLUTIONS.indexOf(rel.resolution) >= 0 ? rel.resolution : 'UNRESOLVED' },
      otEligibleHeadcount: sNum_(u.otEligibleHeadcount), notes: sStr_(u.notes, 1000), params: sanitizeParams_(u.params)
    };
  });
  // A saved unit can be archived but never silently deleted.
  existingUnits.forEach(function (u) {
    if (!seen[u.id]) { units.push(u); seen[u.id] = true; }
  });

  function rowId(prefix, v) { var id = sStr_(v, 64); return ID_RE_.test(id) ? id : prefix + Utilities.getUuid().slice(0, 8); }
  var transfers = (Array.isArray(input.transfers) ? input.transfers : []).slice(0, 500).map(function (t) {
    return { id: rowId('T-', t.id), sourceUnitId: sStr_(t.sourceUnitId, 64), destUnitId: sStr_(t.destUnitId, 64), fte: sNum_(t.fte),
      competencyConfirmed: sBool_(t.competencyConfirmed), coverageCompatible: sBool_(t.coverageCompatible), notes: sStr_(t.notes, 500) };
  });
  var cnc = (Array.isArray(input.cncContributions) ? input.cncContributions : []).slice(0, 500).map(function (c) {
    return { id: rowId('C-', c.id), cncRef: sStr_(c.cncRef, 64).trim(), unitId: sStr_(c.unitId, 64), qualified: sBool_(c.qualified),
      totalHours: sNum_(c.totalHours), adminHours: sNum_(c.adminHours), directCareHours: sNum_(c.directCareHours), notes: sStr_(c.notes, 500) };
  });
  return { errors: errors, state: { settings: settings, units: units, transfers: transfers, cncContributions: cnc } };
}

// -----------------------------------------------------------------------------
// Results sheet (derived output, safe to overwrite)
// -----------------------------------------------------------------------------
function writeResultsSheet_(result) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(APP_CONFIG.SHEETS.RESULTS) || ss.insertSheet(APP_CONFIG.SHEETS.RESULTS);
  sh.clearContents();
  var sm = result.summary, h = result.hours;
  function v(x) { return x === null || x === undefined ? '' : x; }
  var head = [
    ['Nursing Workforce Calculator — results (derived; do not edit)', '', ''],
    ['Reporting month', result.month ? result.month.ym : '', result.month ? result.month.days + ' days' : ''],
    ['FTE method', h.mode === 'DEDUCT' ? 'Deduct unavailable hours' : 'Relief uplift', 'Hours per FTE: ' + (h.hoursPerFTE ? h.hoursPerFTE.toFixed(2) : 'n/a')],
    ['Status', sm.provisional ? 'PROVISIONAL' : 'Complete', sm.provisionalReasons.join('; ').slice(0, 1000)],
    ['Current RN headcount / FTE', sm.currentRNHC, sm.currentRNFTE],
    ['Required RN FTE (known units)', sm.requiredRNFTE, 'Establishment (rounded per unit): ' + sm.establishment],
    ['Net gap FTE (Current − Required)', sm.netGapFTE, 'Shortages ' + sm.shortageFTE + ' / Surpluses ' + sm.surplusFTE],
    ['Confirmed transfers FTE', sm.confirmedTransferFTE, ''],
    ['Recruitment need FTE', sm.recruitmentFTE, sm.recruitmentPosts + ' posts'],
    ['PCA/PCT headcount', sm.pcaHC, 'Not RN capacity'],
    ['CNC headcount', sm.cncHC, 'CNC direct-care contribution FTE: ' + sm.cncContributionFTE],
    ['Total workforce headcount', sm.totalWorkforceHC, ''],
    ['Uncovered hours', Math.round(sm.uncoveredHours), 'Feasible OT: ' + (sm.feasibleOTHours === null ? 'Data Required' : Math.round(sm.feasibleOTHours))],
    ['Generated', new Date(), '']
  ];
  sh.getRange(1, 1, head.length, 3).setValues(head);
  var cols = ['Unit ID', 'Unit', 'Section', 'Method', 'Status', 'Counted in totals', 'Coverage hours', 'Required FTE', 'Establishment',
    'Current HC', 'Current FTE', 'CNC FTE', 'Net gap', 'Transfer out', 'Transfer in', 'Post-transfer gap', 'Remaining shortage',
    'Uncovered hours', 'Feasible OT hours', 'Missing data', 'Notes'];
  var rows = result.units.map(function (r) {
    return [r.id, r.name, r.section, r.methodLabel, r.status, r.counted ? 'Yes' : 'No', r.coverageHours === null ? '' : Math.round(r.coverageHours * 100) / 100,
      v(r.requiredFTE), v(r.establishment), r.currentHC, r.currentFTE, r.cncFTE, v(r.netGap), v(r.transferOut), v(r.transferIn), v(r.postGap),
      v(r.remainingShortage), r.uncoveredHours === null ? '' : Math.round(r.uncoveredHours), r.feasibleOT === null || r.feasibleOT === undefined ? '' : Math.round(r.feasibleOT),
      r.missing.join('; '), r.notes.join(' ')];
  });
  var start = head.length + 2;
  sh.getRange(start, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  if (rows.length) sh.getRange(start + 1, 1, rows.length, cols.length).setValues(rows);
}
