/**
 * Minimal in-memory mock of the Apps Script services used by this project,
 * so the real .gs files can be executed and tested under Node.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const GS_FILES = ['Config.gs', 'Calculations.gs', 'Setup.gs', 'Code.gs'];

function chain(obj) {
  return new Proxy(obj, {
    get(t, k) { return k in t ? t[k] : () => chain(t); }
  });
}

class MockSheet {
  constructor(name) { this.name = name; this.data = []; this.formats = {}; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if ((this.data[r] || []).some(v => v !== '' && v !== null && v !== undefined)) return r + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(row => { for (let c = (row || []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { m = Math.max(m, c + 1); break; } });
    return m;
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  cell(r, c) { return ((this.data[r - 1] || [])[c - 1]); }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getRange(row, col, nr, nc) { return chain(new MockRange(this, row, col, nr || 1, nc || 1)); }
  clearContents() { this.data = []; return this; }
  setFrozenRows() { return this; }
}

class MockRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) { const v = this.sheet.cell(this.row + r, this.col + c); line.push(v === undefined || v === null ? '' : v); }
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) throw new Error(`setValues dimension mismatch on ${this.sheet.name}: range ${this.nr}x${this.nc}, data ${vals.length}x${vals[0] && vals[0].length}`);
    vals.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return chain(this);
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return chain(this); }
  clearContent() { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) if (this.sheet.cell(this.row + r, this.col + c) !== undefined) this.sheet.set(this.row + r, this.col + c, ''); return chain(this); }
  setNumberFormat(f) { this.sheet.formats[this.col] = f; return chain(this); }
}

class MockSpreadsheet {
  constructor() { this.sheets = {}; }
  getId() { return 'mock-ss-id'; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { if (this.sheets[n]) throw new Error('exists ' + n); this.sheets[n] = new MockSheet(n); return this.sheets[n]; }
  getUrl() { return 'https://mock'; }
}

function createContext(opts) {
  const ss = (opts && opts.spreadsheet) || new MockSpreadsheet();
  const props = {};
  let uuid = 0;
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, getUi: () => chain({}) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'planner@example.org' }), getScriptTimeZone: () => 'UTC' },
    Utilities: {
      getUuid: () => 'uuid-' + String(++uuid).padStart(8, '0'),
      formatDate: (d, tz, fmt) => fmt === 'yyyy-MM' ? d.toISOString().slice(0, 7) : d.toISOString()
    },
    Logger: { log: () => {} },
    HtmlService: {
      createTemplateFromFile: () => chain({ evaluate: () => chain({}) }),
      createHtmlOutputFromFile: name => ({ getContent: () => fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8') })
    }
  };
  vm.createContext(ctx);
  ((opts && opts.fileOrder) || GS_FILES).forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  ctx.__ss = ss;
  return ctx;
}

/** Plain engine only (no services) — mirrors how the browser loads it. */
function loadEngine() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Config.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Calculations.gs'), 'utf8'), ctx);
  return ctx;
}

module.exports = { createContext, loadEngine, MockSpreadsheet, ROOT, GS_FILES };
