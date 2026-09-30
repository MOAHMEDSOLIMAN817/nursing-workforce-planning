/**
 * Setup.gs — idempotent initialisation and sheet storage helpers.
 *
 * initializeSystem() can be run any number of times. It creates missing
 * sheets, appends missing columns and missing settings keys, and seeds units
 * only when the Units sheet has never been seeded. It never overwrites saved
 * inputs.
 */

function initializeSystem() {
  var ss = getSpreadsheet_();
  var report = [];
  var S = APP_CONFIG.SHEETS;
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  [S.SETTINGS, S.UNITS, S.TRANSFERS, S.CONTRIB, S.AUDIT, S.META].forEach(function (name) {
    var created = ensureSheet_(ss, name);
    var added = ensureHeaders_(ss.getSheetByName(name), APP_CONFIG.COLUMNS[name]);
    if (created) report.push('Created sheet ' + name);
    else if (added.length) report.push(name + ': added columns ' + added.join(', '));
  });
  if (ensureSheet_(ss, S.RESULTS)) report.push('Created sheet ' + S.RESULTS);
  applyTextFormats_(ss);

  // Settings: add missing keys only.
  var existing = readSettingsRaw_();
  var missing = NwcCalc.SETTINGS_FIELDS.filter(function (f) { return !(f.key in existing); });
  if (missing.length) {
    var defaults = NwcCalc.defaultSettings();
    defaults.reportingMonth = currentMonth_();
    var sh = ss.getSheetByName(S.SETTINGS);
    var rows = missing.map(function (f) { return [f.key, toCell_(defaults[f.key]), f.label, new Date()]; });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    report.push('Added ' + missing.length + ' default setting(s)');
  }

  // Seed units exactly once.
  var meta = readMeta_();
  var unitRows = readTable_(S.UNITS).rows;
  if (!meta.seeded) {
    if (!unitRows.length) {
      writeUnits_(getSeedUnits_(), 'initializeSystem');
      report.push('Seeded ' + getSeedUnits_().length + ' units from the workbook');
    } else {
      report.push('Units sheet already has data — not seeded');
    }
    setMeta_('seeded', 'TRUE');
    setMeta_('seeded_at', new Date().toISOString());
  }
  if (!meta.revision) setMeta_('revision', '1');
  var ver = Number(meta.schema_version || 0);
  if (ver < APP_CONFIG.SCHEMA_VERSION) {
    if (ver < 2) migrateToV2_().forEach(function (m) { report.push(m); });
    if (ver < 3) migrateToV3_().forEach(function (m) { report.push(m); });
    setMeta_('schema_version', String(APP_CONFIG.SCHEMA_VERSION));
  }

  if (report.length) appendAudit_('initializeSystem', report.join('; '));
  var msg = report.length ? report.join('\n') : 'System already initialised — nothing changed.';
  Logger.log(msg);
  return msg;
}

function ensureInitialized_() {
  var ss = getSpreadsheet_();
  var meta = ss.getSheetByName(APP_CONFIG.SHEETS.META);
  if (!meta) { initializeSystem(); return; }
  var m = readMeta_();
  if (!m.seeded || Number(m.schema_version || 0) < APP_CONFIG.SCHEMA_VERSION) initializeSystem();
}

/**
 * Version 1 → 2. Adds unit types and converts hours-based CNC rows into
 * FTE allocations. Saved inputs are never overwritten; the v1 sheet is left
 * in place (read-only) for audit.
 */
/**
 * Version 2 → 3. Other & OPD units switch to "Required FTE entered manually",
 * prefilled with their current base required FTE. Previous method inputs stay
 * in params_json, so a unit can be switched back in Full view.
 */
function migrateToV3_() {
  var state = { settings: readSettings_(), units: readUnits_(), transfers: readTransfers_(), contributions: readContributions_() };
  var ids = NwcCalc.convertOtherToManual(state);
  if (!ids.length) return [];
  var changed = {};
  ids.forEach(function (id) { changed[id] = true; });
  writeUnits_(state.units, 'migration', changed);
  return ['Switched ' + ids.length + ' Other & OPD unit(s) to manual Required FTE (previous inputs kept)'];
}

function migrateToV2_() {
  var out = [];
  var units = readUnits_();
  var typed = 0;
  units.forEach(function (u) { if (!u.unitType) { u.unitType = NwcCalc.unitTypeOf(u); typed++; } });
  if (typed) { writeUnits_(units, 'migration', {}); out.push('Assigned unit types to ' + typed + ' unit(s)'); }

  var legacy = readTable_(APP_CONFIG.SHEETS.LEGACY_CNC).rows.filter(function (r) { return r.contribution_id !== ''; });
  if (legacy.length && !readContributions_().length) {
    var settings = readSettings_();
    var hpf = NwcCalc.hoursModel(settings, NwcCalc.monthInfo(settings.reportingMonth)).hoursPerFTE;
    var rows = legacy.map(function (r) {
      var dc = Number(r.direct_care_hours) || 0, adm = Number(r.admin_hours) || 0;
      var total = Number(r.total_hours) || (dc + adm);
      return {
        id: String(r.contribution_id), category: 'CNC', staffRef: cellStr_(r.cnc_ref), unitId: cellStr_(r.unit_id),
        allocatedFTE: hpf && total ? Math.min(1, total / hpf) : '', contributionPct: total ? dc / total * 100 : '',
        approved: cellBool_(r.qualified), countedInRNFTE: false,
        notes: 'Migrated from v1: ' + total + ' h total, ' + dc + ' h direct care, ' + adm + ' h admin. ' + cellStr_(r.notes)
      };
    });
    writeContributions_(rows);
    out.push('Migrated ' + rows.length + ' CNC row(s) from CNC_Contributions to Contributions');
  }
  return out;
}

function getSpreadsheet_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('No spreadsheet found. Open the script from its Google Sheet (Extensions → Apps Script) and run initializeSystem().');
}

function currentMonth_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'UTC', 'yyyy-MM');
}

// -----------------------------------------------------------------------------
// Generic table helpers (header-name based)
// -----------------------------------------------------------------------------
function ensureSheet_(ss, name) {
  if (ss.getSheetByName(name)) return false;
  var sh = ss.insertSheet(name);
  var cols = APP_CONFIG.COLUMNS[name];
  if (cols) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e8eef7');
    sh.setFrozenRows(1);
  }
  return true;
}

/** Appends any missing header columns. Never removes or reorders columns. */
function ensureHeaders_(sh, cols) {
  if (!sh || !cols) return [];
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  if (headers.length === 1 && headers[0] === '') headers = [];
  var missing = cols.filter(function (c) { return headers.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e8eef7');
    sh.setFrozenRows(1);
  }
  return missing;
}

/** Text format for ID, month and day-list columns so Sheets never coerces them. */
function applyTextFormats_(ss) {
  var textCols = {
    Settings: ['key', 'value'],
    Units: ['unit_id', 'open_days', 'related_unit_id', 'params_json'],
    Transfers: ['transfer_id', 'source_unit_id', 'dest_unit_id'],
    Contributions: ['allocation_id', 'staff_ref', 'unit_id']
  };
  Object.keys(textCols).forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh) return;
    var headers = headerRow_(sh);
    textCols[name].forEach(function (c) {
      var i = headers.indexOf(c);
      if (i >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });
}

function headerRow_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

function readTable_(name) {
  var sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) return { headers: [], rows: [] };
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var o = { _raw: row };
    headers.forEach(function (h, i) { if (h) o[h] = row[i]; });
    rows.push(o);
  }
  return { headers: headers, rows: rows };
}

/**
 * Rewrites the data rows of a sheet from records keyed by header name.
 * Columns not in the records (e.g. added by users) are preserved per key.
 * keepUnlisted: existing rows whose key is not in records are kept.
 */
function writeTable_(name, keyCol, records, keepUnlisted) {
  var sh = getSpreadsheet_().getSheetByName(name);
  ensureHeaders_(sh, APP_CONFIG.COLUMNS[name]);
  var table = readTable_(name);
  var headers = headerRow_(sh);
  var existingByKey = {};
  table.rows.forEach(function (r) { existingByKey[String(r[keyCol])] = r._raw; });
  var listed = {};
  var grid = records.map(function (rec) {
    var key = String(rec[keyCol]);
    listed[key] = true;
    var base = (existingByKey[key] || []).slice();
    while (base.length < headers.length) base.push('');
    headers.forEach(function (h, i) { if (h in rec) base[i] = toCell_(rec[h]); });
    return base.slice(0, headers.length);
  });
  if (keepUnlisted) {
    table.rows.forEach(function (r) {
      if (!listed[String(r[keyCol])]) {
        var base = r._raw.slice(); while (base.length < headers.length) base.push('');
        grid.push(base.slice(0, headers.length));
      }
    });
  }
  var clearRows = Math.max(sh.getLastRow() - 1, 0);
  if (clearRows) sh.getRange(2, 1, clearRows, headers.length).clearContent();
  if (grid.length) sh.getRange(2, 1, grid.length, headers.length).setValues(grid);
}

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object' && !isDate_(v)) return JSON.stringify(v);
  return v;
}

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function cellStr_(v) {
  if (isDate_(v)) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'UTC', 'yyyy-MM');
  return v === null || v === undefined ? '' : String(v);
}
function cellNum_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  return isFinite(n) ? n : '';
}
function cellBool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// -----------------------------------------------------------------------------
// Settings / meta / audit
// -----------------------------------------------------------------------------
function readSettingsRaw_() {
  var out = {};
  readTable_(APP_CONFIG.SHEETS.SETTINGS).rows.forEach(function (r) { if (r.key) out[String(r.key)] = r.value; });
  return out;
}

function readSettings_() {
  var raw = readSettingsRaw_(), out = {};
  NwcCalc.SETTINGS_FIELDS.forEach(function (f) {
    var v = f.key in raw ? raw[f.key] : f.def;
    if (f.type === 'number') out[f.key] = cellNum_(v);
    else if (f.type === 'bool') out[f.key] = cellBool_(v);
    else if (f.type === 'month') out[f.key] = cellStr_(v);
    else out[f.key] = cellStr_(v);
  });
  return out;
}

function writeSettings_(settings) {
  var now = new Date();
  var recs = NwcCalc.SETTINGS_FIELDS.map(function (f) {
    return { key: f.key, value: settings[f.key] === undefined ? '' : settings[f.key], label: f.label, updated_at: now };
  });
  writeTable_(APP_CONFIG.SHEETS.SETTINGS, 'key', recs, true);
}

function readMeta_() {
  var out = {};
  readTable_(APP_CONFIG.SHEETS.META).rows.forEach(function (r) { if (r.key) out[String(r.key)] = String(r.value); });
  if (out.seeded) out.seeded = out.seeded.toUpperCase() === 'TRUE';
  return out;
}

function setMeta_(key, value) {
  var sh = getSpreadsheet_().getSheetByName(APP_CONFIG.SHEETS.META);
  var colA = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var r = 1; r < colA.length; r++) {
    if (String(colA[r][0]) === key) { sh.getRange(r + 1, 2).setValue(value); return; }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

function appendAudit_(action, details) {
  var sh = getSpreadsheet_().getSheetByName(APP_CONFIG.SHEETS.AUDIT);
  if (!sh) return;
  var user = '';
  try { user = Session.getActiveUser().getEmail(); } catch (e) { user = ''; }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([[new Date(), user, action, String(details).slice(0, 45000)]]);
}

// -----------------------------------------------------------------------------
// Units / transfers / CNC mapping
// -----------------------------------------------------------------------------
function unitFromRow_(r) {
  var params = {};
  try { params = r.params_json ? JSON.parse(String(r.params_json)) : {}; } catch (e) { params = {}; }
  return {
    id: String(r.unit_id), name: cellStr_(r.name), section: cellStr_(r.section) === 'INPATIENT' ? 'INPATIENT' : 'OTHER', unitType: cellStr_(r.unit_type),
    method: cellStr_(r.method), isOpen: r.is_open === '' ? true : cellBool_(r.is_open), archived: cellBool_(r.archived),
    sortOrder: cellNum_(r.sort_order),
    currentRNHeadcount: cellNum_(r.current_rn_hc), currentRNFTE: cellNum_(r.current_rn_fte), minRNPerShift: cellNum_(r.min_rn_per_shift),
    schedule: { weekdayHours: cellNum_(r.weekday_hours), openDays: cellStr_(r.open_days), fridayHours: cellNum_(r.friday_hours), holidayHours: cellNum_(r.holiday_hours) },
    manualOverrideFTE: cellNum_(r.manual_override_fte), manualOverrideReason: cellStr_(r.manual_override_reason),
    relation: { type: cellStr_(r.relation_type), unitId: cellStr_(r.related_unit_id), resolution: cellStr_(r.relation_resolution) || 'UNRESOLVED' },
    otEligibleHeadcount: cellNum_(r.ot_eligible_hc), notes: cellStr_(r.notes), params: params,
    updatedAt: isDate_(r.updated_at) ? r.updated_at.toISOString() : cellStr_(r.updated_at)
  };
}

function unitToRecord_(u, user, now) {
  var sch = u.schedule || {}, rel = u.relation || {};
  return {
    unit_id: u.id, name: u.name, section: u.section, unit_type: u.unitType || NwcCalc.unitTypeOf(u), method: u.method, is_open: u.isOpen !== false, archived: !!u.archived,
    sort_order: u.sortOrder, current_rn_hc: u.currentRNHeadcount, current_rn_fte: u.currentRNFTE, min_rn_per_shift: u.minRNPerShift,
    weekday_hours: sch.weekdayHours, open_days: sch.openDays, friday_hours: sch.fridayHours, holiday_hours: sch.holidayHours,
    manual_override_fte: u.manualOverrideFTE, manual_override_reason: u.manualOverrideReason,
    relation_type: rel.type || '', related_unit_id: rel.unitId || '', relation_resolution: rel.resolution || 'UNRESOLVED',
    ot_eligible_hc: u.otEligibleHeadcount, notes: u.notes, params_json: JSON.stringify(u.params || {}),
    updated_at: now, updated_by: user
  };
}

function readUnits_() {
  return readTable_(APP_CONFIG.SHEETS.UNITS).rows.filter(function (r) { return r.unit_id !== ''; }).map(unitFromRow_)
    .sort(function (a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); });
}

function writeUnits_(units, user, changedIds) {
  var now = new Date();
  var prev = {};
  readTable_(APP_CONFIG.SHEETS.UNITS).rows.forEach(function (r) { prev[String(r.unit_id)] = r; });
  var recs = units.map(function (u) {
    var rec = unitToRecord_(u, user, now);
    if (changedIds && !changedIds[u.id] && prev[u.id]) { rec.updated_at = prev[u.id].updated_at; rec.updated_by = prev[u.id].updated_by; }
    return rec;
  });
  writeTable_(APP_CONFIG.SHEETS.UNITS, 'unit_id', recs, true);
}

function readTransfers_() {
  return readTable_(APP_CONFIG.SHEETS.TRANSFERS).rows.filter(function (r) { return r.transfer_id !== ''; }).map(function (r) {
    return { id: String(r.transfer_id), sourceUnitId: cellStr_(r.source_unit_id), destUnitId: cellStr_(r.dest_unit_id), fte: cellNum_(r.fte),
      competencyConfirmed: cellBool_(r.competency_confirmed), coverageCompatible: cellBool_(r.coverage_compatible), notes: cellStr_(r.notes) };
  });
}

function writeTransfers_(list) {
  var now = new Date();
  writeTable_(APP_CONFIG.SHEETS.TRANSFERS, 'transfer_id', list.map(function (t) {
    return { transfer_id: t.id, source_unit_id: t.sourceUnitId, dest_unit_id: t.destUnitId, fte: t.fte,
      competency_confirmed: !!t.competencyConfirmed, coverage_compatible: !!t.coverageCompatible, notes: t.notes, updated_at: now };
  }), false);
}

function readContributions_() {
  return readTable_(APP_CONFIG.SHEETS.CONTRIB).rows.filter(function (r) { return r.allocation_id !== ''; }).map(function (r) {
    return { id: String(r.allocation_id), category: cellStr_(r.category) === 'PCA' ? 'PCA' : 'CNC', staffRef: cellStr_(r.staff_ref),
      unitId: cellStr_(r.unit_id), allocatedFTE: cellNum_(r.allocated_fte), contributionPct: cellNum_(r.contribution_pct),
      approved: cellBool_(r.approved), countedInRNFTE: cellBool_(r.counted_in_rn_fte), notes: cellStr_(r.notes) };
  });
}

function writeContributions_(list) {
  var now = new Date();
  writeTable_(APP_CONFIG.SHEETS.CONTRIB, 'allocation_id', list.map(function (c) {
    return { allocation_id: c.id, category: c.category, staff_ref: c.staffRef, unit_id: c.unitId, allocated_fte: c.allocatedFTE,
      contribution_pct: c.contributionPct, approved: !!c.approved, counted_in_rn_fte: !!c.countedInRNFTE, notes: c.notes, updated_at: now };
  }), false);
}
