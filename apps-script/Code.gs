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
    .addItem('Initialise / repair sheets', 'menuInitialize')
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

function menuInitialize() {
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
      contributions: readContributions_()
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
    writeContributions_(state.contributions);
    writeResultsSheet_(result);

    var rev = current + 1;
    setMeta_('revision', String(rev));
    setMeta_('saved_at', new Date().toISOString());
    setMeta_('saved_by', user);
    appendAudit_('save', 'rev ' + rev + '; units changed: ' + (changedNames.join(', ') || 'none') +
      '; transfers: ' + state.transfers.length + '; allocations: ' + state.contributions.length +
      '; required FTE ' + result.summary.requiredFTE.toFixed(2) + '; final planning shortage ' + result.summary.finalShortageFTE.toFixed(2) +
      (result.summary.provisional ? ' (completed units only — provisional)' : ''));
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
      unitType: NwcCalc.UNIT_TYPES[u.unitType] ? u.unitType : '',
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
  units.forEach(function (u) { if (!u.unitType) u.unitType = NwcCalc.unitTypeOf(u); });
  // A saved unit can be archived but never silently deleted.
  existingUnits.forEach(function (u) {
    if (!seen[u.id]) { units.push(u); seen[u.id] = true; }
  });

  function rowId(prefix, v) { var id = sStr_(v, 64); return ID_RE_.test(id) ? id : prefix + Utilities.getUuid().slice(0, 8); }
  var transfers = (Array.isArray(input.transfers) ? input.transfers : []).slice(0, 500).map(function (t) {
    return { id: rowId('T-', t.id), sourceUnitId: sStr_(t.sourceUnitId, 64), destUnitId: sStr_(t.destUnitId, 64), fte: sNum_(t.fte),
      competencyConfirmed: sBool_(t.competencyConfirmed), coverageCompatible: sBool_(t.coverageCompatible), notes: sStr_(t.notes, 500) };
  });
  var contributions = (Array.isArray(input.contributions) ? input.contributions : []).slice(0, 1000).map(function (c) {
    return { id: rowId('A-', c.id), category: c.category === 'PCA' ? 'PCA' : 'CNC', staffRef: sStr_(c.staffRef, 64).trim(),
      unitId: sStr_(c.unitId, 64), allocatedFTE: sNum_(c.allocatedFTE), contributionPct: sNum_(c.contributionPct),
      approved: sBool_(c.approved), countedInRNFTE: sBool_(c.countedInRNFTE), notes: sStr_(c.notes, 500) };
  });
  return { errors: errors, state: { settings: settings, units: units, transfers: transfers, contributions: contributions } };
}

// -----------------------------------------------------------------------------
// Results sheet (derived output, safe to overwrite)
// -----------------------------------------------------------------------------
function writeResultsSheet_(result) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(APP_CONFIG.SHEETS.RESULTS) || ss.insertSheet(APP_CONFIG.SHEETS.RESULTS);
  sh.clearContents();
  var sm = result.summary, h = result.hours;
  var r2 = function (x) { return x === null || x === undefined ? 'Data Required' : typeof x === 'number' ? Math.round(x * 100) / 100 : x; };
  var r0 = function (x) { return x === null || x === undefined ? 'Data Required' : typeof x === 'number' ? Math.round(x) : x; };
  var head = [
    ['Nursing Workforce Calculator — results (derived; do not edit). Gap = required − credited: positive = shortage, negative = surplus.', '', ''],
    ['Reporting month', result.month ? result.month.ym : '', result.month ? result.month.days + ' days' : ''],
    ['FTE method / basis', h.mode === 'DEDUCT' ? 'Deduct unavailable hours' : 'Relief uplift',
      'Hours per FTE: ' + (h.hoursPerFTE ? h.hoursPerFTE.toFixed(2) : 'n/a') + ' · requirement basis: ' + (sm.basis === 'WHOLE_SHIFT' ? 'whole-shift staffing' : 'average workload')],
    ['Totals', sm.totalsLabel, sm.provisionalReasons.join('; ').slice(0, 1000)],
    ['Required FTE (completed units)', r2(sm.requiredFTE), 'Establishment (rounded per unit): ' + sm.establishment],
    ['Current RN FTE (same units)', r2(sm.currentRNFTE), 'All units: ' + r2(sm.currentRNFTEAllUnits) + ' FTE, ' + sm.currentRNHC + ' headcount'],
    ['CNC credited FTE', r2(sm.cncCreditedFTE), 'Headcount ' + sm.cncHC + ', FTE available ' + r2(sm.cncAvailableFTE) + ', allocated ' + r2(sm.cncAllocatedFTE)],
    ['PCA/PCT credited FTE', r2(sm.pcaCreditedFTE), 'Headcount ' + sm.pcaHC + ', FTE available ' + r2(sm.pcaAvailableFTE) + ', allocated ' + r2(sm.pcaAllocatedFTE)],
    ['RN coverage shortage FTE', r2(sm.rnShortageFTE), 'Surplus ' + r2(sm.rnSurplusFTE) + ' (not offset across units)'],
    ['Final planning shortage FTE', r2(sm.finalShortageFTE), sm.scenarioApproved ? 'Contribution assumptions approved' : 'PLANNING SCENARIO — contribution assumptions not yet approved'],
    ['Total headcount (RN + CNC + PCA/PCT)', sm.totalHC, ''],
    ['Estimated overtime required: uncovered hours', r0(sm.uncoveredHours), 'Feasible OT hours: ' + r0(sm.feasibleOTHours) + '; estimated OT cost: ' + (sm.otCost === 'RATE' ? 'Rate Required' : r0(sm.otCost))],
    ['Remaining recruitment FTE (after feasible OT)', r2(sm.remainingRecruitFTE), 'Not actual overtime worked or payroll payable'],
    ['Generated', new Date(), '']
  ];
  sh.getRange(1, 1, head.length, 3).setValues(head);
  var cols = ['Unit ID', 'Unit', 'Type', 'Method', 'Status', 'Counted in totals', 'Required FTE', 'Average-workload FTE', 'Whole-shift FTE',
    'Current RN FTE', 'CNC FTE', 'PCA/PCT FTE', 'Transfer in', 'Transfer out', 'RN gap (+short)', 'Remaining gap (+short)',
    'Required hours', 'Available qualified hours', 'Uncovered hours', 'OT eligible HC', 'Feasible OT hours', 'Estimated OT cost',
    'Remaining recruitment FTE', 'Missing data', 'Notes'];
  var rows = result.units.map(function (r) {
    return [r.id, r.name, r.unitType, r.methodLabel, r.status, r.counted ? 'Yes' : 'No', r2(r.requiredFTE), r2(r.avgFTE), r2(r.shiftFTE),
      r2(r.currentFTE), r2(r.cncFTE), r2(r.pcaFTE), r2(r.transferIn), r2(r.transferOut), r2(r.rnGap), r2(r.adjustedGap),
      r0(r.requiredHours), r0(r.availableQualifiedHours), r0(r.uncoveredHours), r.otEligibleHC === null ? 'Not set' : r.otEligibleHC,
      r0(r.feasibleOT), r.otCost === 'RATE' ? 'Rate Required' : r0(r.otCost), r2(r.remainingRecruitFTE),
      r.missing.join('; '), r.notes.join(' ')];
  });
  var start = head.length + 2;
  sh.getRange(start, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  if (rows.length) sh.getRange(start + 1, 1, rows.length, cols.length).setValues(rows);
}
