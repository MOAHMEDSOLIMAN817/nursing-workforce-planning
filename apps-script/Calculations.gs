/**
 * Calculations.gs — the ONE calculation engine for the Nursing Workforce Calculator.
 *
 * The same source runs on the server (Apps Script V8) and in the browser:
 * Code.gs serialises NWC_ENGINE_FACTORY_ with Function.prototype.toString()
 * and injects it into Index.html, so the numbers shown while editing are
 * produced by exactly the code that re-validates them before saving.
 *
 * Rules for this file:
 *   - Pure JavaScript only (no SpreadsheetApp, no DOM, no Date.now()).
 *   - Everything lives inside NWC_ENGINE_FACTORY_ so it can be serialised.
 *   - Calculations keep full precision; only the UI rounds for display.
 *
 * Sign convention: gap = required FTE − available credited FTE.
 *   positive = shortage, negative = surplus.
 *
 * All defaults are PLANNING ASSUMPTIONS requiring local approval. Nothing here
 * is a mandatory clinical standard.
 */
function NWC_ENGINE_FACTORY_() {
  'use strict';

  var VERSION = '3.0.0';
  var EPS = 1e-9;

  var STATUS = {
    MET: 'Coverage Met',
    GAP: 'Coverage Gap',
    DATA: 'Data Required',
    OVERRIDE: 'Manual Override',
    CLOSED: 'Closed'
  };

  // JS getUTCDay() order.
  var DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NON_FRIDAY_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

  // ---------------------------------------------------------------------------
  // Global settings (Settings page). Stored one row per key in the Settings sheet.
  // ---------------------------------------------------------------------------
  var SETTINGS_FIELDS = [
    { key: 'reportingMonth', group: 'Period', label: 'Reporting month', type: 'month', def: '2026-10',
      help: 'Calendar days, Fridays and weekday counts are taken from this month.' },
    { key: 'holidaysInMonth', group: 'Period', label: 'Public holidays in month', type: 'number', def: 0, min: 0,
      help: 'Assumed to fall on regular (non-Friday) days. Each unit sets its own holiday opening hours.' },

    { key: 'contractedWeeklyHours', group: 'Hours per FTE', label: 'Contracted weekly hours', type: 'number', def: 48, min: 0.01 },
    { key: 'shiftLengthHours', group: 'Hours per FTE', label: 'Shift length (hours)', type: 'number', def: 12, min: 0.01 },
    { key: 'scheduledHoursOverride', group: 'Hours per FTE', label: 'Available monthly hours per FTE (override)', type: 'number', def: '', min: 0.01, optional: true,
      help: 'Blank = weekly hours × calendar days ÷ 7 (48 h → 205.71 h in a 30-day month). Enter 208 for 48 × 52 ÷ 12.' },
    { key: 'applyReliefFactor', group: 'Leave & absence coverage', label: 'Include Leave & Absence Coverage', type: 'bool', def: false,
      help: 'Optional coverage for annual leave, days off, sickness and unplanned absence.' },
    { key: 'reliefFactor', group: 'Leave & absence coverage', label: 'Coverage / Relief Factor', type: 'number', def: 1.17, min: 1, max: 1.5, step: 0.01,
      help: 'Final Required FTE = Base Required FTE × factor (only when coverage is included).' },
    { key: 'leaveHours', group: 'Leave & absence coverage', label: 'Leave hours per FTE per month (reference)', type: 'number', def: 20, min: 0,
      help: 'Not deducted from hours. Used only to suggest a relief factor.' },
    { key: 'trainingHours', group: 'Leave & absence coverage', label: 'Training hours per FTE per month (reference)', type: 'number', def: 4, min: 0 },
    { key: 'otherUnavailableHours', group: 'Leave & absence coverage', label: 'Other unavailable hours per FTE per month (reference)', type: 'number', def: 6, min: 0 },
    // v2 settings kept only so saved data round-trips; ignored by the v3 engine and hidden in the UI.
    { key: 'fteMode', group: 'Legacy', label: 'FTE method (legacy, ignored)', type: 'enum', def: 'DEDUCT', options: ['DEDUCT', 'UPLIFT'], legacy: true },
    { key: 'reliefUpliftPct', group: 'Legacy', label: 'Relief uplift % (legacy, ignored)', type: 'number', def: 15, min: 0, max: 200, legacy: true },
    { key: 'requirementBasis', group: 'Hours per FTE', label: 'Requirement basis', type: 'enum', def: 'AVERAGE', options: ['AVERAGE', 'WHOLE_SHIFT'],
      help: 'Average workload FTE, or the FTE needed to staff whole nurses on every shift.' },

    { key: 'otMaxHoursPerRN', group: 'Overtime', label: 'Maximum overtime hours per eligible RN per month', type: 'number', def: 48, min: 0,
      help: 'Hospital planning default of 48 h — a configurable assumption, not a policy.' },
    { key: 'otEligiblePct', group: 'Overtime', label: 'Share of current RN headcount eligible for overtime %', type: 'number', def: '', min: 0, max: 100, optional: true,
      help: 'Blank = eligibility not confirmed (feasible overtime shows Data Required). Units can override with an eligible headcount.' },

    { key: 'cncHeadcount', group: 'Support staff & contributions', label: 'CNC headcount', type: 'number', def: 35, min: 0, integer: true },
    { key: 'cncFTE', group: 'Support staff & contributions', label: 'CNC FTE available', type: 'number', def: 35, min: 0, optional: true,
      help: 'Blank = equal to headcount. Unit allocations cannot exceed this.' },
    { key: 'cncDirectCarePct', group: 'Support staff & contributions', label: 'Default CNC qualified direct-care % (after administrative duties)', type: 'number', def: 25, min: 0, max: 100,
      help: 'Used when an allocation row has no own %. Planning assumption requiring approval.' },
    { key: 'pcaHeadcount', group: 'Support staff & contributions', label: 'PCA/PCT headcount', type: 'number', def: 54, min: 0, integer: true },
    { key: 'pcaFTE', group: 'Support staff & contributions', label: 'PCA/PCT FTE available', type: 'number', def: 54, min: 0, optional: true,
      help: 'Blank = equal to headcount. Unit allocations cannot exceed this.' },
    { key: 'pcaSubstitutionPct', group: 'Support staff & contributions', label: 'Default PCA/PCT approved support-task substitution %', type: 'number', def: 25, min: 0, max: 100,
      help: 'Share of an allocated PCA/PCT FTE that substitutes locally approved support tasks. A PCA/PCT is never treated as a qualified RN.' },
    { key: 'pcaMaxSharePct', group: 'Support staff & contributions', label: 'Maximum PCA/PCT credit as % of unit required FTE', type: 'number', def: 20, min: 0, max: 100,
      help: 'Caps support-task substitution per unit.' },
    { key: 'pcaAssumptionsApproved', group: 'Support staff & contributions', label: 'PCA/PCT and CNC contribution assumptions formally approved', type: 'enum', def: 'NO', options: ['NO', 'YES'],
      help: 'Until YES, the adjusted workforce planning gap is labelled a planning scenario.' },
    { key: 'pcaReducesRNWorkload', group: 'Support staff & contributions', label: 'Approved workload model removes PCA/PCT support-task hours from RN overtime need', type: 'enum', def: 'NO', options: ['NO', 'YES'],
      help: 'Only YES when the approved model explicitly removes these hours. Otherwise PCA/PCT never covers qualified RN overtime gaps.' },

    { key: 'costRNMonthly', group: 'Costs (optional)', label: 'RN fully loaded monthly cost per FTE', type: 'number', def: '', min: 0, optional: true },
    { key: 'costCNCMonthly', group: 'Costs (optional)', label: 'CNC fully loaded monthly cost per FTE', type: 'number', def: '', min: 0, optional: true },
    { key: 'costPCAMonthly', group: 'Costs (optional)', label: 'PCA/PCT fully loaded monthly cost per FTE', type: 'number', def: '', min: 0, optional: true },
    { key: 'costOTPerHour', group: 'Costs (optional)', label: 'Overtime cost per hour', type: 'number', def: '', min: 0, optional: true,
      help: 'Blank = "Rate Required" for estimated overtime cost.' },
    { key: 'costTempPerHour', group: 'Costs (optional)', label: 'Temporary staff cost per hour', type: 'number', def: '', min: 0, optional: true },
    { key: 'costTransferPerFTE', group: 'Costs (optional)', label: 'Transfer one-off cost per FTE (orientation)', type: 'number', def: '', min: 0, optional: true },
    { key: 'currencyLabel', group: 'Costs (optional)', label: 'Currency label', type: 'text', def: 'SAR' }
  ];

  // ---------------------------------------------------------------------------
  // Workload methods. Parameters are stored per method (unit.params[METHOD]).
  // Switching method never reinterprets another method's parameters.
  // ---------------------------------------------------------------------------
  var METHODS = {
    MANUAL: {
      label: 'Required FTE entered manually', section: 'OTHER', key: ['requiredFTE'],
      fields: [
        { key: 'requiredFTE', label: 'Required FTE (entered manually)', short: 'Required FTE', type: 'number', min: 0,
          help: 'Your own figure. Leave & absence coverage is applied on top only when it is switched on.' }
      ]
    },
    RATIO: {
      label: 'Patient-to-RN ratio', section: 'INPATIENT', key: ['beds', 'occupancyPct', 'patientsPerRN'],
      fields: [
        { key: 'beds', label: 'Operational beds', short: 'Beds', type: 'number', min: 0 },
        { key: 'occupancyPct', label: 'Occupancy %', short: 'Occ %', type: 'number', min: 0, max: 100 },
        { key: 'patientsPerRN', label: 'Patients per RN', short: 'Pts/RN', type: 'number', min: 0.01, positive: true },
        { key: 'shiftCensus', label: 'Shift census (optional)', type: 'number', min: 0, optional: true,
          help: 'Actual or explicitly assumed census for whole-nurse shift staffing. Blank = rounded-up average occupied beds (assumption).' }
      ]
    },
    ACUITY: {
      label: 'Acuity groups (advanced)', section: 'INPATIENT', key: ['beds'],
      fields: [
        { key: 'beds', label: 'Operational beds', short: 'Beds', type: 'number', min: 0 }
      ],
      tables: {
        groups: { label: 'Patient groups (mutually exclusive)', columns: [
          { key: 'name', label: 'Group', type: 'text' },
          { key: 'patients', label: 'Average patients', type: 'number', min: 0 },
          { key: 'patientsPerRN', label: 'Patients per RN', type: 'number', min: 0.01, positive: true }
        ] }
      }
    },
    OR: {
      label: 'Operating rooms', section: 'OTHER', key: ['rooms', 'rnPerRoom'],
      fields: [
        { key: 'rooms', label: 'Concurrent operating rooms', short: 'Rooms', type: 'number', min: 0 },
        { key: 'rnPerRoom', label: 'RN roles per room', short: 'RN/room', type: 'number', min: 0,
          help: 'e.g. scrub + circulating. Applied during the unit\'s staffed operating hours.' },
        { key: 'prepMinutesPerRoomDay', label: 'Extra preparation RN minutes per room per operating day', type: 'number', min: 0, optional: true },
        { key: 'prepIncluded', label: 'Preparation already included in room hours', type: 'bool' },
        { key: 'recoveryRN', label: 'Recovery (PACU) RN during operating hours', type: 'number', min: 0, optional: true },
        { key: 'recoveryIncluded', label: 'Recovery staffed elsewhere / already included', type: 'bool' },
        { key: 'emergencyRN', label: 'Emergency theatre RN outside operating hours', type: 'number', min: 0, optional: true },
        { key: 'emergencyIncluded', label: 'Emergency cover already included / not applicable', type: 'bool' }
      ]
    },
    ER: {
      label: 'Emergency volume × acuity', section: 'OTHER', key: [],
      fields: [],
      tables: {
        periods: { label: 'Time periods (every calendar day)', columns: [
          { key: 'name', label: 'Period', type: 'text' },
          { key: 'hoursPerDay', label: 'Hours per day', type: 'number', min: 0, max: 24 },
          { key: 'minRN', label: 'Minimum RN for essential functions', type: 'number', min: 0 }
        ] },
        workload: { label: 'Workload by period and acuity (per month)', columns: [
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'acuity', label: 'Acuity level', type: 'text' },
          { key: 'casesPerMonth', label: 'Cases per month', type: 'number', min: 0 },
          { key: 'minutesPerCase', label: 'RN minutes per case', type: 'number', min: 0 }
        ] }
      }
    },
    DELIVERY: {
      label: 'Delivery workload', section: 'OTHER', key: ['deliveriesPerMonth', 'rnHoursPerDelivery'],
      fields: [
        { key: 'deliveriesPerMonth', label: 'Deliveries per month', short: 'Deliveries', type: 'number', min: 0 },
        { key: 'rnHoursPerDelivery', label: 'RN hours per delivery (incl. 1:1 active labour)', short: 'RN h each', type: 'number', min: 0 },
        { key: 'otherCasesPerMonth', label: 'Other assessments per month (triage, observation)', type: 'number', min: 0, optional: true },
        { key: 'minutesPerOtherCase', label: 'RN minutes per other assessment', type: 'number', min: 0, optional: true }
      ]
    },
    PROCEDURE: {
      label: 'Procedures (endoscopy / cathlab)', section: 'OTHER', key: ['proceduresPerMonth', 'procedureMinutes'],
      fields: [
        { key: 'proceduresPerMonth', label: 'Procedures per month', short: 'Procedures', type: 'number', min: 0 },
        { key: 'procedureMinutes', label: 'Average procedure minutes', short: 'Minutes', type: 'number', min: 0 },
        { key: 'rnPerProcedure', label: 'RN roles per procedure', type: 'number', min: 0 },
        { key: 'prepMinutesPerProcedure', label: 'RN preparation/turnover minutes per procedure', type: 'number', min: 0, optional: true },
        { key: 'recoveryMinutesPerPatient', label: 'Recovery minutes per patient', type: 'number', min: 0, optional: true },
        { key: 'patientsPerRecoveryRN', label: 'Recovery patients per RN', type: 'number', min: 0.01, optional: true, positive: true },
        { key: 'recoveryIncluded', label: 'Recovery staffed elsewhere / already included', type: 'bool' }
      ]
    },
    CSSD: {
      label: 'CSSD (RN posts + technician workload)', section: 'OTHER', key: ['rnPosts'],
      fields: [
        { key: 'rnPosts', label: 'RN posts during opening hours', short: 'RN posts', type: 'number', min: 0,
          help: 'Supervision / infection-control RN posts. Technician processing work is NOT an RN requirement.' },
        { key: 'setsPerMonth', label: 'Instrument sets processed per month', type: 'number', min: 0, optional: true },
        { key: 'techMinutesPerSet', label: 'Technician minutes per set', type: 'number', min: 0, optional: true },
        { key: 'currentTechnicians', label: 'Current technicians (headcount)', type: 'number', min: 0, optional: true }
      ]
    },
    CLINIC: {
      label: 'Clinic-based (active clinics × RN per clinic)', section: 'OTHER', key: ['clinics', 'utilisationPct', 'rnPerClinic'],
      fields: [
        { key: 'clinics', label: 'Clinic rooms', short: 'Clinics', type: 'number', min: 0 },
        { key: 'utilisationPct', label: 'Clinics active at the same time %', short: 'Active %', type: 'number', min: 0, max: 100 },
        { key: 'rnPerClinic', label: 'RN per active clinic', short: 'RN/clinic', type: 'number', min: 0 }
      ]
    },
    ACTIVITY: {
      label: 'Patient-volume-based (visits × RN minutes)', section: 'OTHER', key: ['activitiesPerMonth', 'minutesPerActivity'],
      fields: [
        { key: 'activitiesPerMonth', label: 'Patient visits / nursing activities per month', short: 'Visits', type: 'number', min: 0 },
        { key: 'minutesPerActivity', label: 'RN minutes per visit / activity', short: 'Min each', type: 'number', min: 0 },
        { key: 'supportHoursPerMonth', label: 'Additional uncovered support workload (hours/month)', type: 'number', min: 0, optional: true }
      ]
    },
    POSTS: {
      label: 'Fixed RN posts', section: 'OTHER', key: ['rnPosts'],
      fields: [
        { key: 'rnPosts', label: 'Concurrent RN posts during opening hours', short: 'RN posts', type: 'number', min: 0 }
      ]
    }
  };

  /** Unit types restrict which methods a unit may use (e.g. OPD: clinic or patient volume only). */
  var UNIT_TYPES = {
    INPATIENT: { label: 'Inpatient ward / critical care', section: 'INPATIENT', methods: ['RATIO', 'ACUITY'] },
    OPD: { label: 'Outpatient (OPD)', section: 'OTHER', methods: ['MANUAL', 'CLINIC', 'ACTIVITY'] },
    OR: { label: 'Operating rooms', section: 'OTHER', methods: ['MANUAL', 'OR'] },
    ER: { label: 'Emergency', section: 'OTHER', methods: ['MANUAL', 'ER'] },
    DELIVERY: { label: 'Delivery / labour', section: 'OTHER', methods: ['MANUAL', 'DELIVERY'] },
    PROCEDURE: { label: 'Procedure unit', section: 'OTHER', methods: ['MANUAL', 'PROCEDURE'] },
    CSSD: { label: 'CSSD', section: 'OTHER', methods: ['MANUAL', 'CSSD'] },
    OTHER: { label: 'Other service', section: 'OTHER', methods: ['MANUAL', 'POSTS', 'ACTIVITY'] }
  };
  var METHOD_DEFAULT_TYPE = { MANUAL: 'OTHER', RATIO: 'INPATIENT', ACUITY: 'INPATIENT', CLINIC: 'OPD', ACTIVITY: 'OPD', OR: 'OR', ER: 'ER',
    DELIVERY: 'DELIVERY', PROCEDURE: 'PROCEDURE', CSSD: 'CSSD', POSTS: 'OTHER' };

  var RELATION_TYPES = ['', 'SUBSET_OF', 'POSSIBLE_DUPLICATE_OF'];
  var RELATION_RESOLUTIONS = ['UNRESOLVED', 'SEPARATE', 'EXCLUDE'];
  var CONTRIB_CATEGORIES = ['CNC', 'PCA'];

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function isBlank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function num(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function bool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'Yes' || v === 'YES'; }
  function round2(n) { return n === null || n === undefined ? n : Math.round((n + (n >= 0 ? EPS : -EPS)) * 100) / 100; }
  function ceilSafe(n) { return n === null ? null : Math.ceil(n - 1e-7); }
  function sum(list, fn) { var t = 0; for (var i = 0; i < list.length; i++) { var v = fn(list[i]); if (v !== null && v !== undefined) t += v; } return t; }
  function pos(n) { return n > EPS ? n : 0; }
  function normName(s) { return String(s || '').toLowerCase().replace(/[‒-―\-–—]/g, '-').replace(/\s+/g, ' ').trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmt(n) { return n === null || n === undefined ? '—' : (Math.round(n * 100) / 100).toString(); }

  // ---------------------------------------------------------------------------
  // Calendar and hours per FTE
  // ---------------------------------------------------------------------------
  function monthInfo(ym) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    var days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var counts = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    for (var d = 1; d <= days; d++) counts[DAY_CODES[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]]++;
    return { ym: ym, year: y, month: mo, days: days, dayCounts: counts, fridays: counts.Fri };
  }

  /**
   * Hours per FTE (v3).
   *  hoursPerFTE           = available monthly hours per FTE (weekly × days ÷ 7, or the override).
   *                          Base Required FTE = required hours ÷ hoursPerFTE.
   *  applyReliefFactor     = optional leave & absence coverage (default off).
   *  effectiveFactor       = reliefFactor when applied, else 1. Final Required FTE = Base × effectiveFactor.
   *  productiveHoursPerFTE = hoursPerFTE ÷ effectiveFactor — the hours one FTE actually covers.
   *                          Used for supply, uncovered/overtime hours and recruitment, so that
   *                          Final FTE × productive hours = required hours (the factor is never counted as work).
   * Leave/training/other hours are reference only: they suggest a factor but are never deducted.
   */
  function hoursModel(settings, mi) {
    var s = settings || {};
    var weekly = num(s.contractedWeeklyHours);
    var override = num(s.scheduledHoursOverride);
    var days = mi ? mi.days : null;
    var scheduled = override !== null ? override : (weekly !== null && days ? weekly * days / 7 : null);
    var apply = bool(s.applyReliefFactor);
    var factor = num(s.reliefFactor);
    if (factor === null) factor = 1.17;
    var unavailable = (num(s.leaveHours) || 0) + (num(s.trainingHours) || 0) + (num(s.otherUnavailableHours) || 0);
    var out = {
      scheduledHours: scheduled, scheduledSource: override !== null ? 'Manual override' : 'Weekly hours × days ÷ 7',
      hoursPerFTE: scheduled > 0 ? scheduled : null,
      applyReliefFactor: apply, reliefFactor: factor, effectiveFactor: apply ? factor : 1,
      productiveHoursPerFTE: null, unavailableHours: unavailable, suggestedFactor: null
    };
    if (out.hoursPerFTE && out.effectiveFactor > 0) out.productiveHoursPerFTE = out.hoursPerFTE / out.effectiveFactor;
    if (scheduled > unavailable && unavailable > 0) out.suggestedFactor = scheduled / (scheduled - unavailable);
    return out;
  }

  function parseOpenDays(s) {
    var list = String(s === undefined || s === null ? '' : s).split(/[\s,]+/).filter(function (x) { return x; });
    var out = [];
    list.forEach(function (d) {
      var code = d.charAt(0).toUpperCase() + d.slice(1, 3).toLowerCase();
      if (NON_FRIDAY_DAYS.indexOf(code) >= 0 && out.indexOf(code) < 0) out.push(code);
    });
    return out;
  }

  /** Monthly opening hours from the unit schedule (regular days, Fridays, holidays). */
  function scheduleHours(unit, settings, mi) {
    var sch = unit.schedule || {};
    var wh = num(sch.weekdayHours), fh = num(sch.fridayHours), hh = num(sch.holidayHours);
    var days = parseOpenDays(sch.openDays);
    var missing = [];
    if (wh === null) missing.push('Weekday opening hours');
    if (fh === null) missing.push('Friday opening hours');
    var holidays = Math.max(0, num(settings.holidaysInMonth) || 0);
    if (holidays > 0 && hh === null) missing.push('Holiday opening hours');
    if (!mi || missing.length) return { hours: null, missing: missing, openDaysCount: null };
    var regularDayCount = 0;
    days.forEach(function (d) { regularDayCount += mi.dayCounts[d]; });
    var holidaysApplied = Math.min(holidays, regularDayCount);
    var regularDays = regularDayCount - holidaysApplied;
    var hours = regularDays * wh + mi.fridays * fh + holidaysApplied * (hh || 0);
    var openDaysCount = (wh > 0 ? regularDays : 0) + (fh > 0 ? mi.fridays : 0) + ((hh || 0) > 0 ? holidaysApplied : 0);
    return {
      hours: hours, missing: [], openDaysCount: openDaysCount,
      detail: regularDays + ' regular days × ' + wh + ' h + ' + mi.fridays + ' Fridays × ' + fh + ' h' +
        (holidaysApplied ? ' + ' + holidaysApplied + ' holidays × ' + (hh || 0) + ' h' : '')
    };
  }

  // ---------------------------------------------------------------------------
  // Method calculations. Each returns
  //   { hours, shiftHours, missing[], lines[], ... }
  // hours      = average-workload RN coverage hours for the month
  // shiftHours = coverage hours needed to staff whole nurses on every shift
  // ---------------------------------------------------------------------------
  function need(p, key, label, missing) {
    var v = num(p[key]);
    if (v === null) missing.push(label);
    return v;
  }
  function withMinimum(workHours, minRN, openHours, lines) {
    var minHours = minRN * openHours;
    lines.push('Minimum coverage: ' + minRN + ' RN × ' + fmt(openHours) + ' open h = ' + fmt(minHours) + ' h');
    if (minHours > workHours + EPS) lines.push('Minimum coverage applies (exceeds workload)');
    return Math.max(workHours, minHours);
  }
  /** Whole-nurse staffing for a flat opening schedule. */
  function wholeShift(hours, openHours) {
    if (!(openHours > 0)) return hours;
    return ceilSafe(hours / openHours) * openHours;
  }

  var CALC = {
    MANUAL: function (u, p, ctx) {
      var missing = [], lines = [];
      var fte = need(p, 'requiredFTE', 'Required FTE', missing);
      if (missing.length || !ctx.hours.hoursPerFTE) return { hours: null, missing: missing, lines: lines };
      var hours = fte * ctx.hours.hoursPerFTE;   // expressed as hours so overtime uses the same chain as other methods
      lines.push('Required FTE entered manually: ' + fmt(fte));
      return { hours: hours, shiftHours: hours, missing: [], lines: lines };
    },
    RATIO: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var beds = need(p, 'beds', 'Operational beds', missing);
      var occ = need(p, 'occupancyPct', 'Occupancy %', missing);
      var ppr = need(p, 'patientsPerRN', 'Patients per RN', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN per shift', missing);
      missing = missing.concat(sch.missing);
      if (missing.length || !(ppr > 0)) return { hours: null, missing: missing, lines: lines };
      var occupied = beds * occ / 100;
      var ratioRN = occupied / ppr;
      var avgRN = Math.max(ratioRN, minRN);
      lines.push('Average occupied beds = ' + beds + ' × ' + occ + '% = ' + fmt(occupied));
      lines.push('Average RN coverage = MAX(' + fmt(occupied) + ' ÷ ' + ppr + ', ' + minRN + ') = ' + fmt(avgRN));
      lines.push('Average-workload hours = ' + fmt(avgRN) + ' × ' + fmt(sch.hours) + ' open h (' + sch.detail + ')');
      var census = num(p.shiftCensus);
      var censusAssumed = census === null;
      if (censusAssumed) census = ceilSafe(occupied);
      var shiftRN = Math.max(ceilSafe(census / ppr), ceilSafe(minRN));
      lines.push('Whole-shift staffing = ' + shiftRN + ' RN per shift (census ' + census + (censusAssumed ? ', assumed' : '') + ') × ' + fmt(sch.hours) + ' h');
      return {
        hours: avgRN * sch.hours, shiftHours: shiftRN * sch.hours, missing: [], lines: lines, occupied: occupied, avgRN: avgRN,
        minApplied: minRN > ratioRN + EPS, shiftRN: shiftRN, shiftCensus: census, shiftCensusAssumed: censusAssumed
      };
    },
    ACUITY: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var beds = need(p, 'beds', 'Operational beds', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN per shift', missing);
      var groups = (p.groups || []).filter(function (g) { return !(isBlank(g.name) && isBlank(g.patients) && isBlank(g.patientsPerRN)); });
      if (!groups.length) missing.push('At least one patient group');
      groups.forEach(function (g, i) {
        if (num(g.patients) === null) missing.push('Group ' + (g.name || i + 1) + ': patients');
        if (!(num(g.patientsPerRN) > 0)) missing.push('Group ' + (g.name || i + 1) + ': patients per RN');
      });
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var occupied = 0, ratioRN = 0, shiftRNRaw = 0;
      groups.forEach(function (g) {
        var n = num(g.patients), r = num(g.patientsPerRN);
        occupied += n; ratioRN += n / r; shiftRNRaw += ceilSafe(n) / r;
        lines.push(g.name + ': ' + fmt(n) + ' ÷ ' + r + ' = ' + fmt(n / r) + ' RN');
      });
      var avgRN = Math.max(ratioRN, minRN);
      var shiftRN = Math.max(ceilSafe(shiftRNRaw), ceilSafe(minRN));
      lines.push('Average RN coverage = MAX(' + fmt(ratioRN) + ', ' + minRN + ') = ' + fmt(avgRN) + ' × ' + fmt(sch.hours) + ' open h');
      lines.push('Whole-shift staffing = ' + shiftRN + ' RN per shift × ' + fmt(sch.hours) + ' h');
      return {
        hours: avgRN * sch.hours, shiftHours: shiftRN * sch.hours, missing: [], lines: lines, occupied: occupied, avgRN: avgRN, beds: beds,
        minApplied: minRN > ratioRN + EPS, shiftRN: shiftRN,
        shiftCensus: sum(groups, function (g) { return ceilSafe(num(g.patients)); }), shiftCensusAssumed: true
      };
    },
    OR: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var rooms = need(p, 'rooms', 'Concurrent operating rooms', missing);
      var rpr = need(p, 'rnPerRoom', 'RN roles per room', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during open hours', missing);
      var prepInc = bool(p.prepIncluded), recInc = bool(p.recoveryIncluded), emInc = bool(p.emergencyIncluded);
      var prep = prepInc ? 0 : need(p, 'prepMinutesPerRoomDay', 'Preparation minutes (or tick "already included")', missing);
      var rec = recInc ? 0 : need(p, 'recoveryRN', 'Recovery RN (or tick "staffed elsewhere")', missing);
      var em = emInc ? 0 : need(p, 'emergencyRN', 'Emergency RN (or tick "already included")', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var roomHours = rooms * rpr * sch.hours;
      var prepHours = rooms * prep / 60 * sch.openDaysCount;
      var recHours = rec * sch.hours;
      var outside = Math.max(0, ctx.month.days * 24 - sch.hours);
      var emHours = em * outside;
      lines.push('Room hours = ' + rooms + ' rooms × ' + rpr + ' RN × ' + fmt(sch.hours) + ' operating h = ' + fmt(roomHours));
      lines.push(prepInc ? 'Preparation: already included' : 'Preparation = ' + rooms + ' × ' + prep + ' min × ' + sch.openDaysCount + ' days = ' + fmt(prepHours) + ' h');
      lines.push(recInc ? 'Recovery: staffed elsewhere / included' : 'Recovery = ' + rec + ' RN × ' + fmt(sch.hours) + ' h = ' + fmt(recHours));
      var inHours = withMinimum(roomHours + prepHours + recHours, minRN, sch.hours, lines);
      lines.push(emInc ? 'Emergency cover: included / not applicable' : 'Emergency = ' + em + ' RN × ' + fmt(outside) + ' h outside operating hours = ' + fmt(emHours));
      return { hours: inHours + emHours, shiftHours: wholeShift(inHours, sch.hours) + ceilSafe(em) * outside,
        missing: [], lines: lines, openHoursOverride: sch.hours + (em > 0 ? outside : 0) };
    },
    ER: function (u, p, ctx) {
      var missing = [], lines = [];
      var periods = (p.periods || []).filter(function (r) { return !isBlank(r.name); });
      var work = (p.workload || []).filter(function (r) { return !(isBlank(r.period) && isBlank(r.acuity) && isBlank(r.casesPerMonth) && isBlank(r.minutesPerCase)); });
      if (!periods.length) missing.push('At least one time period');
      if (!work.length) missing.push('Patient volume by period and acuity');
      periods.forEach(function (r) {
        if (num(r.hoursPerDay) === null) missing.push(r.name + ': hours per day');
        if (num(r.minRN) === null) missing.push(r.name + ': minimum RN');
      });
      work.forEach(function (r) {
        var lbl = (r.period || '?') + ' / ' + (r.acuity || '?');
        if (num(r.casesPerMonth) === null) missing.push(lbl + ': cases per month');
        if (num(r.minutesPerCase) === null) missing.push(lbl + ': RN minutes per case');
      });
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var days = ctx.month.days, total = 0, open = 0, shift = 0;
      periods.forEach(function (per) {
        var wl = sum(work.filter(function (w) { return normName(w.period) === normName(per.name); }),
          function (w) { return num(w.casesPerMonth) * num(w.minutesPerCase) / 60; });
        var ph = num(per.hoursPerDay) * days;
        var minH = num(per.minRN) * ph;
        var req = Math.max(wl, minH);
        open += ph; total += req; shift += wholeShift(req, ph);
        lines.push(per.name + ': workload ' + fmt(wl) + ' h vs minimum ' + per.minRN + ' RN × ' + fmt(ph) + ' h = ' + fmt(minH) + ' h → ' + fmt(req) + ' h');
      });
      return { hours: total, shiftHours: shift, missing: [], lines: lines, openHoursOverride: open };
    },
    DELIVERY: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var n = need(p, 'deliveriesPerMonth', 'Deliveries per month', missing);
      var h = need(p, 'rnHoursPerDelivery', 'RN hours per delivery', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN (concurrent)', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      // Minimum staffing covers the unit while open; delivery care and assessments are added on top.
      var other = (num(p.otherCasesPerMonth) || 0) * (num(p.minutesPerOtherCase) || 0) / 60;
      var minHours = minRN * sch.hours;
      lines.push('Minimum coverage = ' + minRN + ' RN × ' + fmt(sch.hours) + ' open h = ' + fmt(minHours) + ' h');
      lines.push('Delivery workload = ' + n + ' × ' + h + ' h = ' + fmt(n * h) + ' h; other assessments ' + fmt(other) + ' h');
      lines.push('Required hours = ' + fmt(minHours) + ' + ' + fmt(n * h) + ' + ' + fmt(other) + ' = ' + fmt(minHours + n * h + other) + ' h');
      return { hours: minHours + n * h + other, shiftHours: wholeShift(minHours, sch.hours) + n * h + other, missing: [], lines: lines };
    },
    PROCEDURE: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var n = need(p, 'proceduresPerMonth', 'Procedures per month', missing);
      var mins = need(p, 'procedureMinutes', 'Procedure minutes', missing);
      var roles = need(p, 'rnPerProcedure', 'RN roles per procedure', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during sessions', missing);
      var recInc = bool(p.recoveryIncluded);
      var recMin = recInc ? 0 : need(p, 'recoveryMinutesPerPatient', 'Recovery minutes (or tick "staffed elsewhere")', missing);
      var recRatio = recInc ? 1 : need(p, 'patientsPerRecoveryRN', 'Recovery patients per RN', missing);
      missing = missing.concat(sch.missing);
      if (missing.length || !(recRatio > 0)) return { hours: null, missing: missing, lines: lines };
      var prep = num(p.prepMinutesPerProcedure) || 0;
      var procH = n * (mins * roles + prep) / 60;
      var recH = recInc ? 0 : n * recMin / 60 / recRatio;
      lines.push('Procedure RN hours = ' + n + ' × (' + mins + ' min × ' + roles + ' RN + ' + prep + ' min prep) ÷ 60 = ' + fmt(procH));
      lines.push(recInc ? 'Recovery: staffed elsewhere / included' : 'Recovery = ' + n + ' × ' + recMin + ' min ÷ 60 ÷ ' + recRatio + ' = ' + fmt(recH) + ' h');
      return { hours: withMinimum(procH + recH, minRN, sch.hours, lines), missing: [], lines: lines };
    },
    CSSD: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var posts = need(p, 'rnPosts', 'RN posts', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during open hours', missing);
      missing = missing.concat(sch.missing);
      var sets = num(p.setsPerMonth), tmin = num(p.techMinutesPerSet);
      var tech = { status: STATUS.DATA, requiredFTE: null, currentHC: num(p.currentTechnicians) };
      if (sets !== null && tmin !== null && ctx.hours.hoursPerFTE) {
        tech.hours = sets * tmin / 60; tech.requiredFTE = tech.hours / ctx.hours.hoursPerFTE; tech.status = 'Calculated';
      }
      if (missing.length) return { hours: null, missing: missing, lines: lines, technicians: tech };
      var h = Math.max(posts, minRN) * sch.hours;
      lines.push('RN posts = MAX(' + posts + ', min ' + minRN + ') × ' + fmt(sch.hours) + ' open h = ' + fmt(h));
      lines.push('Technician workload is reported separately and is not an RN requirement.');
      return { hours: h, missing: [], lines: lines, technicians: tech };
    },
    CLINIC: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var c = need(p, 'clinics', 'Clinic rooms', missing);
      var ut = need(p, 'utilisationPct', 'Clinics active %', missing);
      var rpc = need(p, 'rnPerClinic', 'RN per active clinic', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during opening hours', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var conc = c * ut / 100 * rpc, rn = Math.max(conc, minRN);
      lines.push('Concurrent RN = ' + c + ' clinics × ' + ut + '% × ' + rpc + ' RN = ' + fmt(conc) + '; with minimum ' + minRN + ' → ' + fmt(rn));
      lines.push('Coverage hours = ' + fmt(rn) + ' × ' + fmt(sch.hours) + ' open h (' + sch.detail + ')');
      return { hours: rn * sch.hours, missing: [], lines: lines, minApplied: minRN > conc + EPS };
    },
    ACTIVITY: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var n = need(p, 'activitiesPerMonth', 'Visits / activities per month', missing);
      var m = need(p, 'minutesPerActivity', 'RN minutes per visit', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during opening hours', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var support = num(p.supportHoursPerMonth) || 0;
      var wl = n * m / 60 + support;
      lines.push('Patient-volume workload = ' + n + ' × ' + m + ' min ÷ 60 + ' + support + ' support h = ' + fmt(wl) + ' h');
      return { hours: withMinimum(wl, minRN, sch.hours, lines), missing: [], lines: lines };
    },
    POSTS: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var posts = need(p, 'rnPosts', 'RN posts', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during opening hours', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var h = Math.max(posts, minRN) * sch.hours;
      lines.push('Posts = MAX(' + posts + ', ' + minRN + ') × ' + fmt(sch.hours) + ' open h = ' + fmt(h));
      return { hours: h, missing: [], lines: lines };
    }
  };

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  function issue(list, level, scope, message, unitId, field) {
    list.push({ level: level, scope: scope, message: message, unitId: unitId || '', field: field || '' });
  }

  function checkField(list, f, value, scope, unitId, prefix) {
    if (f.type !== 'number' || isBlank(value)) return;
    var v = num(value);
    var label = (prefix || '') + f.label;
    if (v === null) { issue(list, 'error', scope, label + ' must be a number.', unitId, f.key); return; }
    if (f.positive && !(v > 0)) { issue(list, 'error', scope, label + ' must be greater than zero.', unitId, f.key); return; }
    if (f.min !== undefined && v < f.min - EPS) issue(list, 'error', scope, label + (f.min > 0 ? ' must be at least ' + f.min + '.' : ' cannot be negative.'), unitId, f.key);
    if (f.max !== undefined && v > f.max + EPS) issue(list, 'error', scope, label + ' must not exceed ' + f.max + '.', unitId, f.key);
    if (f.integer && Math.floor(v) !== v) issue(list, 'error', scope, label + ' must be a whole number.', unitId, f.key);
  }

  function unitTypeOf(u) {
    if (u.unitType && UNIT_TYPES[u.unitType]) return u.unitType;
    if (u.section === 'INPATIENT') return 'INPATIENT';
    return METHOD_DEFAULT_TYPE[u.method] || 'OTHER';
  }
  function allowedMethods(u) { return UNIT_TYPES[unitTypeOf(u)].methods.slice(); }

  var CONTRIB_FIELDS = [
    { key: 'allocatedFTE', label: 'Allocated FTE', type: 'number', min: 0 },
    { key: 'contributionPct', label: 'Contribution %', type: 'number', min: 0, max: 100 }
  ];

  function availablePool(s, cat) {
    var fte = num(cat === 'CNC' ? s.cncFTE : s.pcaFTE);
    return fte === null ? (num(cat === 'CNC' ? s.cncHeadcount : s.pcaHeadcount) || 0) : fte;
  }

  function validateState(state, ctx) {
    var list = [];
    var s = state.settings || {};
    SETTINGS_FIELDS.forEach(function (f) {
      checkField(list, f, s[f.key], 'Settings', '', '');
      if (f.type === 'enum' && f.options.indexOf(s[f.key]) < 0) issue(list, 'error', 'Settings', f.label + ': choose one of ' + f.options.join(' / ') + '.', '', f.key);
    });
    if (!ctx.month) issue(list, 'error', 'Settings', 'Reporting month must be in YYYY-MM format.', '', 'reportingMonth');
    if (ctx.hours.scheduledHours !== null && !(ctx.hours.hoursPerFTE > 0)) {
      issue(list, 'error', 'Settings', 'Available monthly hours per FTE must be positive.', '', 'scheduledHoursOverride');
    }
    if (ctx.hours.scheduledHours === null) issue(list, 'error', 'Settings', 'Scheduled monthly hours cannot be calculated: enter weekly hours or an override.', '', 'contractedWeeklyHours');
    ['cnc', 'pca'].forEach(function (k) {
      var fte = num(s[k + 'FTE']), hc = num(s[k + 'Headcount']);
      if (fte !== null && hc !== null && fte > hc + EPS) issue(list, 'error', 'Settings', (k === 'cnc' ? 'CNC' : 'PCA/PCT') + ' FTE cannot exceed headcount.', '', k + 'FTE');
    });

    var units = activeUnits(state);
    var ids = {}, names = {};
    (state.units || []).forEach(function (u) {
      if (isBlank(u.id)) issue(list, 'error', 'Units', 'A unit has no stable ID.', '', 'id');
      else if (ids[u.id]) issue(list, 'error', 'Units', 'Duplicate unit ID ' + u.id + '.', u.id, 'id');
      ids[u.id] = true;
    });
    units.forEach(function (u) {
      var nm = normName(u.name);
      if (!nm) issue(list, 'error', u.name || u.id, 'Unit name is required.', u.id, 'name');
      else if (names[nm]) issue(list, 'error', u.name, 'Duplicate unit name "' + u.name + '" (also used by another active unit).', u.id, 'name');
      names[nm] = true;
      if (!METHODS[u.method]) { issue(list, 'error', u.name, 'Unknown workload method "' + u.method + '".', u.id, 'method'); return; }
      var type = unitTypeOf(u);
      if (allowedMethods(u).indexOf(u.method) < 0) {
        issue(list, 'error', u.name, UNIT_TYPES[type].label + ' units may only use: ' +
          allowedMethods(u).map(function (m) { return METHODS[m].label; }).join(' or ') + '.', u.id, 'method');
      }
      var hc = num(u.currentRNHeadcount), fte = num(u.currentRNFTE);
      if (hc !== null && hc < 0) issue(list, 'error', u.name, 'Current RN headcount cannot be negative.', u.id, 'currentRNHeadcount');
      if (hc !== null && Math.floor(hc) !== hc) issue(list, 'error', u.name, 'Current RN headcount must be a whole number.', u.id, 'currentRNHeadcount');
      if (fte !== null && fte < 0) issue(list, 'error', u.name, 'Current RN FTE cannot be negative.', u.id, 'currentRNFTE');
      if (fte !== null && hc !== null && fte > hc + EPS) issue(list, 'error', u.name, 'Current RN FTE (' + fte + ') exceeds headcount (' + hc + ').', u.id, 'currentRNFTE');
      var minRN = num(u.minRNPerShift);
      if (minRN !== null && minRN < 0) issue(list, 'error', u.name, 'Minimum RN coverage cannot be negative.', u.id, 'minRNPerShift');
      var ot = num(u.otEligibleHeadcount);
      if (ot !== null && (ot < 0 || Math.floor(ot) !== ot || (hc !== null && ot > hc))) issue(list, 'error', u.name, 'Overtime-eligible headcount must be a whole number between 0 and current RN headcount.', u.id, 'otEligibleHeadcount');
      var sch = u.schedule || {};
      ['weekdayHours', 'fridayHours', 'holidayHours'].forEach(function (k) {
        var v = num(sch[k]);
        if (v !== null && (v < 0 || v > 24)) issue(list, 'error', u.name, 'Opening hours per day must be between 0 and 24 (' + k + ').', u.id, k);
      });
      if (!isBlank(sch.openDays)) {
        var bad = String(sch.openDays).split(/[\s,]+/).filter(function (d) { return d && NON_FRIDAY_DAYS.indexOf(d.charAt(0).toUpperCase() + d.slice(1, 3).toLowerCase()) < 0; });
        if (bad.length) issue(list, 'error', u.name, 'Open days must be from Sat, Sun, Mon, Tue, Wed, Thu (Friday is set separately): ' + bad.join(', '), u.id, 'openDays');
      }
      var wh = num(sch.weekdayHours), sl = num(s.shiftLengthHours);
      if (u.isOpen !== false && wh && sl && Math.abs(wh / sl - Math.round(wh / sl)) > 1e-6 && u.section === 'INPATIENT') {
        issue(list, 'warning', u.name, 'Weekday hours (' + wh + ') are not a whole number of ' + sl + '-hour shifts.', u.id, 'weekdayHours');
      }
      if (!isBlank(u.manualOverrideFTE)) {
        var ovr = num(u.manualOverrideFTE);
        if (ovr === null || ovr < 0) issue(list, 'error', u.name, 'Manual override FTE must be a non-negative number.', u.id, 'manualOverrideFTE');
        if (isBlank(u.manualOverrideReason)) issue(list, 'error', u.name, 'Manual override requires a reason.', u.id, 'manualOverrideReason');
      }
      var def = METHODS[u.method], p = (u.params || {})[u.method] || {};
      def.fields.forEach(function (f) { checkField(list, f, p[f.key], u.name, u.id, ''); });
      Object.keys(def.tables || {}).forEach(function (tk) {
        (p[tk] || []).forEach(function (row, i) {
          def.tables[tk].columns.forEach(function (c) { checkField(list, c, row[c.key], u.name, u.id, def.tables[tk].label + ' row ' + (i + 1) + ': '); });
        });
      });
      if (u.method === 'ACUITY') {
        var gnames = {}, tot = 0;
        (p.groups || []).forEach(function (g) {
          var gn = normName(g.name);
          if (!gn && !isBlank(g.patients)) issue(list, 'error', u.name, 'Every patient group needs a name.', u.id, 'groups');
          if (gn && gnames[gn]) issue(list, 'error', u.name, 'Patient group "' + g.name + '" appears twice — groups must be mutually exclusive.', u.id, 'groups');
          gnames[gn] = true;
          tot += num(g.patients) || 0;
        });
        var beds = num(p.beds);
        if (beds !== null && tot > beds + EPS) issue(list, 'error', u.name, 'Patient groups total ' + round2(tot) + ' patients but the unit has ' + beds + ' beds — groups overlap or census is wrong.', u.id, 'groups');
      }
      if (u.method === 'ER') {
        var pn = {}, hrs = 0;
        (p.periods || []).forEach(function (r) {
          var k = normName(r.name); if (!k) return;
          if (pn[k]) issue(list, 'error', u.name, 'Time period "' + r.name + '" is defined twice.', u.id, 'periods');
          pn[k] = true; hrs += num(r.hoursPerDay) || 0;
        });
        if (hrs > 24 + EPS) issue(list, 'error', u.name, 'ER time periods add up to ' + hrs + ' hours per day (maximum 24).', u.id, 'periods');
        else if (hrs > 0 && hrs < 24 - EPS) issue(list, 'warning', u.name, 'ER time periods cover only ' + hrs + ' hours per day.', u.id, 'periods');
        var wk = {};
        (p.workload || []).forEach(function (w) {
          if (isBlank(w.period) && isBlank(w.casesPerMonth)) return;
          if (!pn[normName(w.period)]) issue(list, 'error', u.name, 'Workload row uses unknown period "' + (w.period || '') + '".', u.id, 'workload');
          var key = normName(w.period) + '|' + normName(w.acuity);
          if (wk[key]) issue(list, 'error', u.name, 'Workload for ' + w.period + ' / ' + w.acuity + ' is entered twice (double counting).', u.id, 'workload');
          wk[key] = true;
        });
      }
      if (u.relation && u.relation.type) {
        var rel = u.relation;
        if (RELATION_TYPES.indexOf(rel.type) < 0) issue(list, 'error', u.name, 'Unknown relation type.', u.id, 'relation');
        if (!findUnit(state, rel.unitId)) issue(list, 'error', u.name, 'Related unit not found.', u.id, 'relation');
        if (rel.unitId === u.id) issue(list, 'error', u.name, 'A unit cannot be related to itself.', u.id, 'relation');
        if (RELATION_RESOLUTIONS.indexOf(rel.resolution) < 0) issue(list, 'error', u.name, 'Unknown relation resolution.', u.id, 'relation');
      }
    });

    // Contribution allocations: no duplicates, no double counting, within available FTE.
    var pair = {}, byRef = {}, totals = { CNC: 0, PCA: 0 }, refs = { CNC: {}, PCA: {} };
    (state.contributions || []).forEach(function (c, i) {
      var cat = c.category, tag = (cat === 'PCA' ? 'PCA/PCT' : 'CNC') + ' allocation row ' + (i + 1) + (c.staffRef ? ' (' + c.staffRef + ')' : '');
      if (CONTRIB_CATEGORIES.indexOf(cat) < 0) { issue(list, 'error', 'Contributions', tag + ': category must be CNC or PCA.', c.unitId, 'category'); return; }
      CONTRIB_FIELDS.forEach(function (f) { checkField(list, f, c[f.key], 'Contributions', c.unitId, tag + ': '); });
      var u = findUnit(state, c.unitId);
      if (isBlank(c.unitId) || !u) issue(list, 'error', 'Contributions', tag + ': assigned unit not found.', c.unitId, 'unitId');
      else if (bool(u.archived)) issue(list, 'warning', 'Contributions', tag + ': unit is archived — not credited.', c.unitId, 'unitId');
      var ref = normName(c.staffRef);
      var key = cat + '|' + c.unitId + '|' + ref;
      if (pair[key]) issue(list, 'error', 'Contributions', tag + ': duplicate allocation — the same ' + (ref ? 'employee' : 'group') + ' is already allocated to this unit.', c.unitId, 'staffRef');
      pair[key] = true;
      var fte = num(c.allocatedFTE) || 0;
      totals[cat] += fte;
      if (ref) {
        refs[cat][ref] = true;
        byRef[cat + '|' + ref] = (byRef[cat + '|' + ref] || 0) + fte;
      }
      if (bool(c.countedInRNFTE)) issue(list, 'warning', 'Contributions', tag + ': already counted in the unit\'s current RN FTE — not credited again.', c.unitId, 'countedInRNFTE');
      if (!bool(c.approved)) issue(list, 'warning', 'Contributions', tag + ': ' + (cat === 'CNC' ? 'qualification for direct care' : 'local support-task approval') + ' not confirmed — not credited.', c.unitId, 'approved');
    });
    Object.keys(byRef).forEach(function (k) {
      if (byRef[k] > 1 + EPS) issue(list, 'error', 'Contributions', k.replace('|', ' ') + ' is allocated ' + round2(byRef[k]) + ' FTE across units — one employee cannot exceed 1.0 FTE.', '', 'allocatedFTE');
    });
    CONTRIB_CATEGORIES.forEach(function (cat) {
      var pool = availablePool(s, cat), label = cat === 'PCA' ? 'PCA/PCT' : 'CNC';
      if (totals[cat] > pool + EPS) issue(list, 'error', 'Contributions', label + ' allocations total ' + round2(totals[cat]) + ' FTE, more than the ' + round2(pool) + ' FTE available.', '', 'allocatedFTE');
      var hc = num(cat === 'CNC' ? s.cncHeadcount : s.pcaHeadcount);
      var n = Object.keys(refs[cat]).length;
      if (hc !== null && n > hc) issue(list, 'error', 'Contributions', n + ' named ' + label + ' employees are allocated but headcount is ' + hc + '.', '', 'staffRef');
    });

    (state.transfers || []).forEach(function (t, i) {
      var v = num(t.fte);
      if (v !== null && v < 0) issue(list, 'error', 'Transfers', 'Transfer row ' + (i + 1) + ': FTE cannot be negative.', '', 'fte');
    });
    return list;
  }

  function findUnit(state, id) {
    var list = state.units || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function activeUnits(state) { return (state.units || []).filter(function (u) { return !bool(u.archived); }); }

  // ---------------------------------------------------------------------------
  // Contributions (credited FTE per unit, before PCA cap)
  // ---------------------------------------------------------------------------
  function evaluateContributions(state, settings, ctx) {
    var rows = [], cnc = {}, pca = {};
    (state.contributions || []).forEach(function (c) {
      var cat = c.category, why = [], ok = true;
      var u = ctx.unitIndex[c.unitId];
      var fte = num(c.allocatedFTE);
      var pctRow = num(c.contributionPct);
      var pct = pctRow !== null ? pctRow : num(cat === 'CNC' ? settings.cncDirectCarePct : settings.pcaSubstitutionPct);
      if (CONTRIB_CATEGORIES.indexOf(cat) < 0) { ok = false; why.push('Unknown category'); }
      if (!u || bool(u.archived)) { ok = false; why.push('No active unit'); }
      if (!(fte > 0)) { ok = false; why.push('Allocated FTE not entered'); }
      if (pct === null) { ok = false; why.push('Contribution % not set'); }
      if (!bool(c.approved)) { ok = false; why.push(cat === 'CNC' ? 'Direct-care qualification not confirmed' : 'Support tasks not locally approved'); }
      if (bool(c.countedInRNFTE)) { ok = false; why.push('Already counted in current RN FTE'); }
      var credited = ok ? fte * pct / 100 : 0;
      if (ok) {
        var map = cat === 'CNC' ? cnc : pca;
        map[c.unitId] = (map[c.unitId] || 0) + credited;
      }
      rows.push({ id: c.id, category: cat, staffRef: c.staffRef, unitId: c.unitId, allocatedFTE: fte, pctUsed: pct,
        pctFromDefault: pctRow === null, eligible: ok, creditedFTE: credited, reasons: why });
    });
    return { rows: rows, cnc: cnc, pca: pca };
  }

  // ---------------------------------------------------------------------------
  // Unit calculation (before transfers)
  // ---------------------------------------------------------------------------
  function calcUnit(u, ctx, contrib) {
    var hpf = ctx.hours.hoursPerFTE, prod = ctx.hours.productiveHoursPerFTE, factor = ctx.hours.effectiveFactor;
    var basis = ctx.settings.requirementBasis === 'WHOLE_SHIFT' ? 'WHOLE_SHIFT' : 'AVERAGE';
    var r = {
      id: u.id, name: u.name, section: u.section, unitType: unitTypeOf(u), method: u.method,
      methodLabel: METHODS[u.method] ? METHODS[u.method].label : u.method,
      isOpen: u.isOpen !== false && u.isOpen !== 'FALSE', status: null, missing: [], lines: [], notes: [],
      openHours: null, coverageHours: null, avgHours: null, shiftHours: null, avgFTE: null, shiftFTE: null, basis: basis,
      avgConcurrentRN: null, baseRequiredFTE: null, reliefFactorApplied: null, coverageAdditionFTE: null, requiredFTE: null, establishment: null,
      currentHC: num(u.currentRNHeadcount) || 0, currentFTE: null, currentFTEAssumed: false,
      cncFTE: contrib.cnc[u.id] || 0, pcaRawFTE: contrib.pca[u.id] || 0, pcaFTE: null, pcaCapped: false,
      shiftRN: null, shiftCensus: null, shiftCensusAssumed: false, occupied: null,
      counted: true, provisionalReasons: [], technicians: null, isOverride: false
    };
    var fteIn = num(u.currentRNFTE);
    r.currentFTE = fteIn === null ? r.currentHC : fteIn;
    r.currentFTEAssumed = fteIn === null;
    if (r.currentFTEAssumed && r.currentHC > 0) r.notes.push('Current FTE assumed equal to headcount.');

    if (u.relation && u.relation.type) {
      var rel = u.relation, other = ctx.unitIndex[rel.unitId];
      var kind = rel.type === 'SUBSET_OF' ? 'subset of' : 'possible duplicate of';
      var oname = other ? other.name : rel.unitId;
      if (rel.resolution === 'EXCLUDE') {
        r.counted = false;
        r.notes.push('Excluded from totals: confirmed as ' + kind + ' ' + oname + '. Its demand and staff must be recorded in ' + oname + '.');
      } else if (rel.resolution === 'UNRESOLVED' || !rel.resolution) {
        r.provisionalReasons.push(u.name + ' may be a ' + kind + ' ' + oname + ' (unresolved)');
        r.notes.push('Unresolved: may be a ' + kind + ' ' + oname + '. Counted separately; totals are provisional.');
      } else {
        r.notes.push('Confirmed separate from ' + oname + '.');
      }
    }

    if (!r.isOpen) {
      r.status = STATUS.CLOSED; r.coverageHours = 0; r.avgHours = 0; r.shiftHours = 0; r.requiredFTE = 0; r.avgFTE = 0; r.shiftFTE = 0;
      r.baseRequiredFTE = 0; r.coverageAdditionFTE = 0;
      r.establishment = 0; r.openHours = 0;
      r.lines.push('Unit closed: no minimum coverage requirement.');
    } else {
      var p = (u.params || {})[u.method] || {};
      var sch = scheduleHours(u, ctx.settings, ctx.month);
      var fn = CALC[u.method];
      var res = fn ? fn(u, p, ctx, sch) : { hours: null, missing: ['Workload method'], lines: [] };
      r.lines = res.lines || [];
      r.missing = res.missing || [];
      r.openHours = res.openHoursOverride !== undefined ? res.openHoursOverride : sch.hours;
      r.occupied = res.occupied === undefined ? null : res.occupied;
      r.shiftCensus = res.shiftCensus === undefined ? null : res.shiftCensus;
      r.shiftCensusAssumed = !!res.shiftCensusAssumed;
      r.minApplied = !!res.minApplied;
      r.technicians = res.technicians || null;
      if (res.hours !== null && res.hours !== undefined) {
        r.avgHours = res.hours;
        r.shiftHours = res.shiftHours !== undefined ? res.shiftHours : wholeShift(res.hours, r.openHours);
        if (hpf) { r.avgFTE = r.avgHours / hpf; r.shiftFTE = r.shiftHours / hpf; }
        r.shiftRN = res.shiftRN !== undefined ? res.shiftRN : (r.openHours > 0 ? ceilSafe(r.avgHours / r.openHours) : null);
        if (r.openHours > 0) r.avgConcurrentRN = r.avgHours / r.openHours;
      }
      var ovr = num(u.manualOverrideFTE);
      if (ovr !== null && !isBlank(u.manualOverrideReason)) {
        // An override is the FINAL required FTE; the relief factor is not applied to it again.
        r.status = STATUS.OVERRIDE; r.isOverride = true;
        r.requiredFTE = ovr; r.baseRequiredFTE = ovr; r.coverageAdditionFTE = 0;
        r.coverageHours = prod ? ovr * prod : null;
        r.notes.push('Manual override: ' + u.manualOverrideReason);
        if (r.avgFTE !== null) r.notes.push('Method result would be ' + round2(basis === 'WHOLE_SHIFT' ? r.shiftFTE : r.avgFTE) + ' FTE.');
      } else if (r.avgHours === null || !hpf) {
        r.status = STATUS.DATA;
        if (!hpf) r.missing.push('Valid hours per FTE (Settings)');
      } else {
        r.coverageHours = basis === 'WHOLE_SHIFT' ? r.shiftHours : r.avgHours;
        r.baseRequiredFTE = r.coverageHours / hpf;
        r.reliefFactorApplied = factor !== 1 ? factor : null;
        r.requiredFTE = r.baseRequiredFTE * factor;
        r.coverageAdditionFTE = r.requiredFTE - r.baseRequiredFTE;
      }
    }
    if (r.requiredFTE !== null) {
      r.establishment = ceilSafe(r.requiredFTE);
      var cap = r.requiredFTE * (num(ctx.settings.pcaMaxSharePct) || 0) / 100;
      r.pcaFTE = Math.min(r.pcaRawFTE, cap);
      r.pcaCapped = r.pcaRawFTE > cap + EPS;
      if (r.pcaCapped) r.notes.push('PCA/PCT credit capped at ' + ctx.settings.pcaMaxSharePct + '% of required FTE (' + round2(cap) + ' of ' + round2(r.pcaRawFTE) + ' FTE allocated).');
    } else {
      r.pcaFTE = r.pcaRawFTE;
    }
    r.rnCreditedBeforeTransfers = r.currentFTE + r.cncFTE;
    return r;
  }

  // ---------------------------------------------------------------------------
  // Transfers: only confirmed, compatible transfers that do not create a
  // qualified-RN shortage in the source are counted. Evaluated in table order.
  // ---------------------------------------------------------------------------
  function calculateTransfers(state, byId) {
    var out = [], sent = {}, received = {};
    (state.transfers || []).forEach(function (t, i) {
      var r = { id: t.id, index: i, sourceUnitId: t.sourceUnitId, destUnitId: t.destUnitId, fte: num(t.fte),
        competencyConfirmed: bool(t.competencyConfirmed), coverageCompatible: bool(t.coverageCompatible), valid: false, reasons: [] };
      var src = byId[t.sourceUnitId], dst = byId[t.destUnitId];
      if (!src) r.reasons.push('Source unit missing, archived or excluded');
      if (!dst) r.reasons.push('Destination unit missing, archived or excluded');
      if (src && dst && src.id === dst.id) r.reasons.push('Source and destination are the same');
      if (!(r.fte > 0)) r.reasons.push('FTE must be greater than zero');
      if (!r.competencyConfirmed) r.reasons.push('Competency not confirmed');
      if (!r.coverageCompatible) r.reasons.push('Coverage compatibility not confirmed');
      if (dst && !dst.isOpen) r.reasons.push('Destination unit is closed');
      if (src && src.requiredFTE === null) r.reasons.push('Source requirement unknown (Data Required)');
      if (dst && dst.requiredFTE === null) r.reasons.push('Destination requirement unknown (Data Required)');
      if (src && src.requiredFTE !== null && r.fte > 0) {
        var already = sent[src.id] || 0, got = received[src.id] || 0;
        var rnAvailable = src.currentFTE + got - already;                 // CNC/PCA credit is not transferable
        var spare = src.rnCreditedBeforeTransfers + got - already - src.requiredFTE;   // qualified coverage only
        if (r.fte > rnAvailable + EPS) r.reasons.push('Source has only ' + round2(Math.max(0, rnAvailable)) + ' RN FTE left to transfer');
        if (r.fte > spare + EPS) r.reasons.push('Would create a shortage in the source (spare ' + round2(Math.max(0, spare)) + ' FTE)');
      }
      if (!r.reasons.length) {
        r.valid = true;
        sent[src.id] = (sent[src.id] || 0) + r.fte;
        received[dst.id] = (received[dst.id] || 0) + r.fte;
        if (dst.rnCreditedBeforeTransfers + received[dst.id] - (sent[dst.id] || 0) > dst.requiredFTE + EPS) {
          r.reasons.push('Note: exceeds the destination shortage');
        }
      }
      out.push(r);
    });
    return { rows: out, sent: sent, received: received };
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------
  function calculate(stateIn) {
    var state = stateIn || {};
    var settings = normalizeSettings(state.settings);
    var mi = monthInfo(settings.reportingMonth);
    var hours = hoursModel(settings, mi);
    var hpf = hours.productiveHoursPerFTE;   // hours one credited FTE actually covers (after optional relief)
    var ctx = { settings: settings, month: mi, hours: hours, unitIndex: {} };
    (state.units || []).forEach(function (u) { ctx.unitIndex[u.id] = u; });
    var norm = { settings: settings, units: state.units, transfers: state.transfers, contributions: state.contributions };
    var issues = validateState(norm, ctx);
    var contrib = evaluateContributions(norm, settings, ctx);

    var results = [], byId = {};
    activeUnits(state).forEach(function (u) {
      var r = calcUnit(u, ctx, contrib);
      results.push(r);
      if (r.counted) byId[r.id] = r;
    });

    var tr = calculateTransfers(state, byId);
    var otMax = num(settings.otMaxHoursPerRN);
    var otPct = num(settings.otEligiblePct);
    var otRate = num(settings.costOTPerHour);
    var pcaRemovesRN = settings.pcaReducesRNWorkload === 'YES';
    results.forEach(function (r) {
      var u = ctx.unitIndex[r.id];
      r.transferOut = tr.sent[r.id] || 0;
      r.transferIn = tr.received[r.id] || 0;
      r.rnCreditedFTE = r.rnCreditedBeforeTransfers + r.transferIn - r.transferOut;
      var eligOverride = num(u.otEligibleHeadcount);
      r.otEligibleSource = eligOverride !== null ? 'Unit override' : (otPct !== null ? 'Settings ' + otPct + '%' : 'Not set');
      r.otEligibleHC = eligOverride !== null ? eligOverride : (otPct !== null ? Math.floor(r.currentHC * otPct / 100 + EPS) : null);
      if (r.requiredFTE === null) {
        r.rnGap = r.adjustedGap = r.availableFTE = null;
        r.requiredHours = r.availableQualifiedHours = r.uncoveredHours = r.otCapacity = r.feasibleOT = null;
        r.remainingUncoveredHours = r.remainingRecruitFTE = r.otCost = null;
        return;
      }
      // Signed gaps: required − credited (positive = shortage).
      r.rnGap = r.requiredFTE - r.rnCreditedFTE;
      r.adjustedGap = r.rnGap - r.pcaFTE;
      r.availableFTE = r.rnCreditedFTE + r.pcaFTE;   // gap = requiredFTE (final) − availableFTE
      if (!r.status) r.status = r.rnGap > EPS ? STATUS.GAP : STATUS.MET;
      // Estimated overtime required (full precision).
      r.requiredHours = r.coverageHours;
      r.pcaHoursRemoved = pcaRemovesRN && hpf ? r.pcaFTE * hpf : 0;
      r.availableQualifiedHours = hpf ? r.rnCreditedFTE * hpf : 0;
      r.uncoveredHours = Math.max(r.requiredHours - r.pcaHoursRemoved - r.availableQualifiedHours, 0);
      if (r.uncoveredHours < 1e-6) r.uncoveredHours = 0;
      r.otCapacity = r.otEligibleHC === null || otMax === null ? null : r.otEligibleHC * otMax;
      if (r.uncoveredHours === 0) r.feasibleOT = 0;
      else r.feasibleOT = r.otCapacity === null ? null : Math.min(r.uncoveredHours, r.otCapacity);
      r.remainingUncoveredHours = r.feasibleOT === null ? null : Math.max(r.uncoveredHours - r.feasibleOT, 0);
      r.remainingRecruitFTE = r.remainingUncoveredHours === null || !hpf ? null : r.remainingUncoveredHours / hpf;
      r.otCost = r.feasibleOT === null ? null : (r.feasibleOT === 0 ? 0 : (otRate === null ? 'RATE' : r.feasibleOT * otRate));
    });

    // --- Summary over COMPLETED units only (same units for required and available) ---
    var counted = results.filter(function (r) { return r.counted; });
    var known = counted.filter(function (r) { return r.requiredFTE !== null; });
    var dataReq = counted.filter(function (r) { return r.status === STATUS.DATA; });
    var provisional = [];
    dataReq.forEach(function (r) { provisional.push(r.name + ': Data Required'); });
    counted.forEach(function (r) { r.provisionalReasons.forEach(function (x) { provisional.push(x); }); });
    var errors = issues.filter(function (x) { return x.level === 'error'; });
    if (errors.length) provisional.push(errors.length + ' validation error(s)');
    var S = function (list, fn) { return sum(list, fn); };

    // Waterfall: Σ per-unit shortages after each credit (no cross-unit offsetting).
    var stage = function (fn) { return S(known, function (r) { return pos(fn(r)); }); };
    var s0 = stage(function (r) { return r.requiredFTE - r.currentFTE; });
    var s1 = stage(function (r) { return r.requiredFTE - r.currentFTE - r.cncFTE; });
    var s2 = stage(function (r) { return r.rnGap; });
    var s3 = stage(function (r) { return r.adjustedGap; });

    var otUnits = known.filter(function (r) { return r.uncoveredHours > 0; });
    var otMissing = otUnits.filter(function (r) { return r.feasibleOT === null; }).length;
    var costMissing = known.some(function (r) { return r.otCost === 'RATE'; });

    var sm = {
      completedUnits: known.length,
      totalsLabel: dataReq.length ? 'Completed units only — provisional' : (provisional.length ? 'Provisional' : 'All units'),
      requiredFTE: S(known, function (r) { return r.requiredFTE; }),
      baseRequiredFTE: S(known, function (r) { return r.baseRequiredFTE; }),
      coverageAdditionFTE: S(known, function (r) { return r.coverageAdditionFTE; }),
      applyReliefFactor: hours.applyReliefFactor, reliefFactor: hours.reliefFactor,
      avgFTE: S(known, function (r) { return r.avgFTE; }),
      shiftFTE: S(known, function (r) { return r.shiftFTE; }),
      establishment: S(known, function (r) { return r.establishment; }),
      currentRNFTE: S(known, function (r) { return r.currentFTE; }),
      currentRNHC: S(counted, function (r) { return r.currentHC; }),
      currentRNFTEAllUnits: S(counted, function (r) { return r.currentFTE; }),
      currentFTEInDataRequiredUnits: S(dataReq, function (r) { return r.currentFTE; }),
      cncCreditedFTE: S(known, function (r) { return r.cncFTE; }),
      pcaCreditedFTE: S(known, function (r) { return r.pcaFTE; }),
      cncCreditedFTEAllUnits: S(counted, function (r) { return r.cncFTE; }),
      pcaCreditedFTEAllUnits: S(counted, function (r) { return r.pcaFTE; }),
      transferFTE: S(tr.rows, function (t) { return t.valid ? t.fte : 0; }),
      invalidTransfers: tr.rows.filter(function (t) { return !t.valid; }).length,
      rnShortageFTE: S(known, function (r) { return pos(r.rnGap); }),
      rnSurplusFTE: S(known, function (r) { return pos(-r.rnGap); }),
      finalShortageFTE: S(known, function (r) { return pos(r.adjustedGap); }),
      finalSurplusFTE: S(known, function (r) { return pos(-r.adjustedGap); }),
      shortageUnits: known.filter(function (r) { return r.adjustedGap > EPS; }).length,
      waterfall: [
        { key: 'gross', label: 'RN shortage before contributions', value: s0 },
        { key: 'cnc', label: 'CNC qualified direct care', value: s1 - s0 },
        { key: 'transfer', label: 'Confirmed transfers', value: s2 - s1 },
        { key: 'rn', label: 'RN coverage shortage', value: s2, subtotal: true },
        { key: 'pca', label: 'PCA/PCT approved support tasks', value: s3 - s2 },
        { key: 'final', label: 'Final planning shortage', value: s3, subtotal: true }
      ],
      requiredHours: S(known, function (r) { return r.requiredHours; }),
      availableQualifiedHours: S(known, function (r) { return r.availableQualifiedHours; }),
      uncoveredHours: S(known, function (r) { return r.uncoveredHours; }),
      otDataMissingUnits: otMissing,
      feasibleOTHours: otMissing ? null : S(known, function (r) { return r.feasibleOT; }),
      feasibleOTHoursKnown: S(known, function (r) { return r.feasibleOT; }),
      remainingUncoveredHours: otMissing ? null : S(known, function (r) { return r.remainingUncoveredHours; }),
      remainingRecruitFTE: otMissing ? null : S(known, function (r) { return r.remainingRecruitFTE; }),
      otCost: otMissing ? null : (costMissing ? 'RATE' : S(known, function (r) { return typeof r.otCost === 'number' ? r.otCost : 0; })),
      cncHC: num(settings.cncHeadcount) || 0,
      pcaHC: num(settings.pcaHeadcount) || 0,
      cncAvailableFTE: availablePool(settings, 'CNC'),
      pcaAvailableFTE: availablePool(settings, 'PCA'),
      cncAllocatedFTE: S(contrib.rows, function (c) { return c.category === 'CNC' ? (c.allocatedFTE || 0) : 0; }),
      pcaAllocatedFTE: S(contrib.rows, function (c) { return c.category === 'PCA' ? (c.allocatedFTE || 0) : 0; }),
      scenarioApproved: settings.pcaAssumptionsApproved === 'YES',
      pcaRemovesRNWorkload: pcaRemovesRN,
      basis: settings.requirementBasis === 'WHOLE_SHIFT' ? 'WHOLE_SHIFT' : 'AVERAGE',
      unitsTotal: results.length,
      unitsCounted: counted.length,
      unitsDataRequired: dataReq.length,
      unitsOverride: counted.filter(function (r) { return r.status === STATUS.OVERRIDE; }).length,
      unitsExcluded: results.length - counted.length,
      provisional: provisional.length > 0,
      provisionalReasons: provisional
    };
    sm.totalHC = sm.currentRNHC + sm.cncHC + sm.pcaHC;
    sm.completenessPct = sm.unitsCounted ? Math.round((sm.unitsCounted - sm.unitsDataRequired) / sm.unitsCounted * 100) : 100;
    sm.dataStatus = sm.unitsDataRequired ? sm.unitsDataRequired + ' unit(s) need data' : (provisional.length ? 'Provisional' : 'Complete');

    var checks = [
      check('Final shortage − surplus = Σ unit adjusted gaps', sm.finalShortageFTE - sm.finalSurplusFTE, S(known, function (r) { return r.adjustedGap; })),
      check('RN shortage − surplus = Σ unit RN gaps', sm.rnShortageFTE - sm.rnSurplusFTE, S(known, function (r) { return r.rnGap; })),
      check('Waterfall steps add up to the final planning shortage', s0 + (s1 - s0) + (s2 - s1) + (s3 - s2), sm.finalShortageFTE),
      check('Required FTE = sum of completed unit rows', sm.requiredFTE, S(known, function (r) { return r.requiredFTE; })),
      check('Final required = base required + coverage addition', sm.requiredFTE, sm.baseRequiredFTE + sm.coverageAdditionFTE),
      check('Current RN headcount = sum of unit rows', sm.currentRNHC, S(counted, function (r) { return r.currentHC; })),
      check('Total headcount = RN + CNC + PCA/PCT', sm.totalHC, sm.currentRNHC + sm.cncHC + sm.pcaHC),
      check('Transfers sent = transfers received', S(counted, function (r) { return r.transferOut; }), S(counted, function (r) { return r.transferIn; })),
      check('CNC allocated ≤ CNC FTE available', Math.min(sm.cncAllocatedFTE, sm.cncAvailableFTE), sm.cncAllocatedFTE),
      check('PCA/PCT allocated ≤ PCA/PCT FTE available', Math.min(sm.pcaAllocatedFTE, sm.pcaAvailableFTE), sm.pcaAllocatedFTE)
    ];
    if (!pcaRemovesRN && hpf) checks.push(check('Uncovered hours ÷ productive hours per FTE = RN coverage shortage', sm.uncoveredHours / hpf, sm.rnShortageFTE));
    if (!otMissing && hpf) checks.push(check('Feasible OT + remaining recruitment × h/FTE = uncovered hours', sm.feasibleOTHours + sm.remainingRecruitFTE * hpf, sm.uncoveredHours));

    return {
      version: VERSION, month: mi, hours: hours, settings: settings, units: results, transfers: tr.rows,
      contributions: contrib.rows, summary: sm, costs: calculateCosts(settings, sm, hours), issues: issues, checks: checks
    };
  }

  function check(label, a, b) {
    return { label: label, calculated: a, reported: b, ok: Math.abs((a || 0) - (b || 0)) < 1e-6 };
  }

  function calculateCosts(s, sm, hours) {
    var cur = s.currencyLabel || '';
    function money(rate, qty) { var r = num(rate); return r === null || qty === null ? null : r * qty; }
    var rn = num(s.costRNMonthly), ot = num(s.costOTPerHour), tmp = num(s.costTempPerHour);
    var hpf = hours.productiveHoursPerFTE;
    var options = [
      { option: 'Confirmed transfers', quantity: sm.transferFTE, unit: 'FTE',
        monthlyCost: 0, oneOffCost: money(s.costTransferPerFTE, sm.transferFTE),
        costPerHour: 0, note: 'Redeploys existing RNs; no additional payroll. Only confirmed, compatible transfers counted.' },
      { option: 'Estimated overtime required (feasible)', quantity: sm.feasibleOTHours, unit: 'hours',
        monthlyCost: sm.otCost === 'RATE' ? null : sm.otCost, costPerHour: ot,
        note: sm.feasibleOTHours === null ? 'Overtime eligibility not set for ' + sm.otDataMissingUnits + ' unit(s) — Data Required.' : 'Capped by eligible RN headcount × maximum hours. Not actual overtime worked or payroll payable.' },
      { option: 'Temporary staff (remaining uncovered hours)', quantity: sm.remainingUncoveredHours, unit: 'hours',
        monthlyCost: money(tmp, sm.remainingUncoveredHours), costPerHour: tmp, note: 'Hours left after feasible overtime.' },
      { option: 'Recruitment', quantity: sm.remainingRecruitFTE, unit: 'FTE',
        monthlyCost: money(rn, sm.remainingRecruitFTE), costPerHour: rn !== null && hpf ? rn / hpf : null,
        note: 'Remaining recruitment FTE after feasible overtime.' }
    ];
    var current = [
      { category: 'RN', fte: sm.currentRNFTEAllUnits, monthlyCost: money(rn, sm.currentRNFTEAllUnits) },
      { category: 'CNC', fte: sm.cncAvailableFTE, monthlyCost: money(s.costCNCMonthly, sm.cncAvailableFTE) },
      { category: 'PCA/PCT', fte: sm.pcaAvailableFTE, monthlyCost: money(s.costPCAMonthly, sm.pcaAvailableFTE) }
    ];
    return { currency: cur, options: options, current: current };
  }

  function normalizeSettings(s) {
    var out = {};
    SETTINGS_FIELDS.forEach(function (f) {
      var v = s && s[f.key] !== undefined ? s[f.key] : f.def;
      out[f.key] = v;
    });
    return out;
  }

  function defaultSettings() { return normalizeSettings({}); }

  function newUnit(id, name, section, method, unitType) {
    var inpatient = section === 'INPATIENT';
    var type = unitType || (inpatient ? 'INPATIENT' : METHOD_DEFAULT_TYPE[method] || 'OPD');
    var m = method || UNIT_TYPES[type].methods[0];
    var u = {
      id: id, name: name || 'New unit', section: inpatient ? 'INPATIENT' : 'OTHER', unitType: type,
      method: m, isOpen: true, archived: false, sortOrder: 999,
      currentRNHeadcount: 0, currentRNFTE: '', minRNPerShift: 1,
      schedule: inpatient
        ? { weekdayHours: 24, openDays: NON_FRIDAY_DAYS.join(','), fridayHours: 24, holidayHours: 24 }
        : { weekdayHours: 8, openDays: NON_FRIDAY_DAYS.join(','), fridayHours: 0, holidayHours: 0 },
      manualOverrideFTE: '', manualOverrideReason: '', relation: { type: '', unitId: '', resolution: 'UNRESOLVED' },
      otEligibleHeadcount: '', notes: '', params: {}
    };
    u.params[u.method] = blankParams(u.method);
    return u;
  }

  function blankParams(method) {
    var def = METHODS[method], p = {};
    if (!def) return p;
    def.fields.forEach(function (f) { p[f.key] = f.type === 'bool' ? false : ''; });
    Object.keys(def.tables || {}).forEach(function (k) { p[k] = []; });
    if (method === 'ER') {
      p.periods = [{ name: 'Day', hoursPerDay: 12, minRN: '' }, { name: 'Night', hoursPerDay: 12, minRN: '' }];
    }
    return p;
  }

  /**
   * Switch a unit's workload method. The previous method's inputs are kept
   * untouched (switching back restores them). The new method uses only its
   * own stored inputs, or blanks — old parameters are never reinterpreted.
   */
  function switchMethod(u, method) {
    u.params = u.params || {};
    if (!u.params[method]) u.params[method] = blankParams(method);
    u.method = method;
    return u;
  }

  /**
   * Switch every non-inpatient unit to MANUAL, prefilled with its current Base Required FTE
   * (rounded to 2 dp) so results do not jump. Other methods' inputs stay in params (not deleted).
   * Units with Data Required get a blank value. Returns the ids that were converted.
   */
  function convertOtherToManual(state) {
    var res = calculate(state), byId = {}, done = [];
    res.units.forEach(function (r) { byId[r.id] = r; });
    (state.units || []).forEach(function (u) {
      if (u.section === 'INPATIENT' || u.method === 'MANUAL') return;
      var r = byId[u.id];
      var base = r && r.baseRequiredFTE !== null && r.baseRequiredFTE !== undefined && !r.isOverride ? round2(r.baseRequiredFTE) : '';
      if (r && r.isOverride) base = '';
      switchMethod(u, 'MANUAL');
      u.params.MANUAL.requiredFTE = u.isOpen === false ? '' : base;
      done.push(u.id);
    });
    return done;
  }

  function newContribution(id, category, unitId) {
    return { id: id, category: category === 'PCA' ? 'PCA' : 'CNC', staffRef: '', unitId: unitId || '', allocatedFTE: '',
      contributionPct: '', approved: false, countedInRNFTE: false, notes: '' };
  }

  return {
    VERSION: VERSION, STATUS: STATUS, METHODS: METHODS, UNIT_TYPES: UNIT_TYPES, SETTINGS_FIELDS: SETTINGS_FIELDS,
    NON_FRIDAY_DAYS: NON_FRIDAY_DAYS, RELATION_TYPES: RELATION_TYPES, RELATION_RESOLUTIONS: RELATION_RESOLUTIONS,
    CONTRIB_CATEGORIES: CONTRIB_CATEGORIES,
    calculate: calculate, monthInfo: monthInfo, hoursModel: hoursModel, scheduleHours: scheduleHours,
    defaultSettings: defaultSettings, normalizeSettings: normalizeSettings, newUnit: newUnit, blankParams: blankParams,
    switchMethod: switchMethod, convertOtherToManual: convertOtherToManual, unitTypeOf: unitTypeOf, allowedMethods: allowedMethods, newContribution: newContribution,
    num: num, bool: bool, round2: round2, ceilSafe: ceilSafe, isBlank: isBlank, normName: normName, clone: clone
  };
}

var NwcCalc = NWC_ENGINE_FACTORY_();
