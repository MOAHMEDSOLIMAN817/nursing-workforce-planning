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
 *
 * All defaults are PLANNING ASSUMPTIONS requiring local approval. Nothing here
 * is a mandatory clinical standard.
 */
function NWC_ENGINE_FACTORY_() {
  'use strict';

  var VERSION = '1.0.0';
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
    { key: 'scheduledHoursOverride', group: 'Hours per FTE', label: 'Scheduled monthly hours (manual override)', type: 'number', def: '', min: 0.01, optional: true,
      help: 'Leave blank to use weekly hours × calendar days ÷ 7.' },
    { key: 'fteMode', group: 'Hours per FTE', label: 'FTE method', type: 'enum', def: 'DEDUCT', options: ['DEDUCT', 'UPLIFT'] },
    { key: 'leaveHours', group: 'Hours per FTE', label: 'Leave hours per FTE per month', type: 'number', def: 20, min: 0,
      help: 'Used only in "Deduct unavailable hours" mode.' },
    { key: 'trainingHours', group: 'Hours per FTE', label: 'Training hours per FTE per month', type: 'number', def: 4, min: 0 },
    { key: 'otherUnavailableHours', group: 'Hours per FTE', label: 'Other unavailable hours per FTE per month', type: 'number', def: 6, min: 0,
      help: 'Sickness, meetings and other non-coverage time.' },
    { key: 'reliefUpliftPct', group: 'Hours per FTE', label: 'Relief uplift %', type: 'number', def: 15, min: 0, max: 200,
      help: 'Used only in "Relief uplift" mode.' },

    { key: 'otMaxHoursPerRN', group: 'Overtime', label: 'Maximum overtime hours per eligible RN per month', type: 'number', def: '', min: 0, optional: true,
      help: 'Blank = Data Required. Feasible overtime is never assumed.' },
    { key: 'otEligiblePct', group: 'Overtime', label: 'Share of current RN headcount eligible for overtime %', type: 'number', def: 100, min: 0, max: 100,
      help: 'Used when a unit has no explicit eligible headcount.' },

    { key: 'pcaHeadcount', group: 'Support staff', label: 'PCA/PCT headcount', type: 'number', def: 54, min: 0, integer: true },
    { key: 'pcaFTE', group: 'Support staff', label: 'PCA/PCT FTE (optional)', type: 'number', def: '', min: 0, optional: true },
    { key: 'cncHeadcount', group: 'Support staff', label: 'CNC headcount', type: 'number', def: 35, min: 0, integer: true },
    { key: 'cncFTE', group: 'Support staff', label: 'CNC FTE (optional)', type: 'number', def: '', min: 0, optional: true },

    { key: 'costRNMonthly', group: 'Costs (optional)', label: 'RN fully loaded monthly cost per FTE', type: 'number', def: '', min: 0, optional: true },
    { key: 'costCNCMonthly', group: 'Costs (optional)', label: 'CNC fully loaded monthly cost per FTE', type: 'number', def: '', min: 0, optional: true },
    { key: 'costPCAMonthly', group: 'Costs (optional)', label: 'PCA/PCT fully loaded monthly cost per FTE', type: 'number', def: '', min: 0, optional: true },
    { key: 'costOTPerHour', group: 'Costs (optional)', label: 'Overtime cost per hour', type: 'number', def: '', min: 0, optional: true },
    { key: 'costTempPerHour', group: 'Costs (optional)', label: 'Temporary staff cost per hour', type: 'number', def: '', min: 0, optional: true },
    { key: 'costTransferPerFTE', group: 'Costs (optional)', label: 'Transfer one-off cost per FTE (orientation)', type: 'number', def: '', min: 0, optional: true },
    { key: 'currencyLabel', group: 'Costs (optional)', label: 'Currency label', type: 'text', def: 'SAR' }
  ];

  // ---------------------------------------------------------------------------
  // Workload methods. Parameters are stored per method (unit.params[METHOD]) so
  // switching method never loses the other method's inputs, and only the active
  // method is ever calculated (no double counting of the same work).
  // ---------------------------------------------------------------------------
  var METHODS = {
    RATIO: {
      label: 'Patient-to-RN ratio', section: 'INPATIENT',
      fields: [
        { key: 'beds', label: 'Operational beds', type: 'number', min: 0 },
        { key: 'occupancyPct', label: 'Occupancy %', type: 'number', min: 0, max: 100 },
        { key: 'patientsPerRN', label: 'Patients per RN', type: 'number', min: 0.01, positive: true },
        { key: 'shiftCensus', label: 'Shift census (optional)', type: 'number', min: 0, optional: true,
          help: 'Actual or explicitly assumed census for whole-nurse shift staffing. Blank = rounded-up average occupied beds (assumption).' }
      ]
    },
    ACUITY: {
      label: 'Acuity groups (advanced)', section: 'INPATIENT',
      fields: [
        { key: 'beds', label: 'Operational beds', type: 'number', min: 0 }
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
      label: 'Operating rooms', section: 'OTHER',
      fields: [
        { key: 'rooms', label: 'Concurrent operating rooms', type: 'number', min: 0 },
        { key: 'rnPerRoom', label: 'RN roles per room', type: 'number', min: 0,
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
      label: 'Emergency volume × acuity', section: 'OTHER',
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
      label: 'Delivery workload', section: 'OTHER',
      fields: [
        { key: 'deliveriesPerMonth', label: 'Deliveries per month', type: 'number', min: 0 },
        { key: 'rnHoursPerDelivery', label: 'RN hours per delivery (incl. 1:1 active labour)', type: 'number', min: 0 },
        { key: 'otherCasesPerMonth', label: 'Other assessments per month (triage, observation)', type: 'number', min: 0, optional: true },
        { key: 'minutesPerOtherCase', label: 'RN minutes per other assessment', type: 'number', min: 0, optional: true }
      ]
    },
    PROCEDURE: {
      label: 'Procedures (endoscopy / cathlab)', section: 'OTHER',
      fields: [
        { key: 'proceduresPerMonth', label: 'Procedures per month', type: 'number', min: 0 },
        { key: 'procedureMinutes', label: 'Average procedure minutes', type: 'number', min: 0 },
        { key: 'rnPerProcedure', label: 'RN roles per procedure', type: 'number', min: 0 },
        { key: 'prepMinutesPerProcedure', label: 'RN preparation/turnover minutes per procedure', type: 'number', min: 0, optional: true },
        { key: 'recoveryMinutesPerPatient', label: 'Recovery minutes per patient', type: 'number', min: 0, optional: true },
        { key: 'patientsPerRecoveryRN', label: 'Recovery patients per RN', type: 'number', min: 0.01, optional: true, positive: true },
        { key: 'recoveryIncluded', label: 'Recovery staffed elsewhere / already included', type: 'bool' }
      ]
    },
    CSSD: {
      label: 'CSSD (RN posts + technician workload)', section: 'OTHER',
      fields: [
        { key: 'rnPosts', label: 'RN posts during opening hours', type: 'number', min: 0,
          help: 'Supervision / infection-control RN posts. Technician processing work is NOT an RN requirement.' },
        { key: 'setsPerMonth', label: 'Instrument sets processed per month', type: 'number', min: 0, optional: true },
        { key: 'techMinutesPerSet', label: 'Technician minutes per set', type: 'number', min: 0, optional: true },
        { key: 'currentTechnicians', label: 'Current technicians (headcount)', type: 'number', min: 0, optional: true }
      ]
    },
    CLINIC: {
      label: 'OPD A: clinic-based', section: 'OTHER',
      fields: [
        { key: 'clinics', label: 'Clinic rooms', type: 'number', min: 0 },
        { key: 'utilisationPct', label: 'Clinics active at the same time %', type: 'number', min: 0, max: 100 },
        { key: 'rnPerClinic', label: 'RN per active clinic', type: 'number', min: 0 }
      ]
    },
    ACTIVITY: {
      label: 'OPD B: activity-based', section: 'OTHER',
      fields: [
        { key: 'activitiesPerMonth', label: 'Nursing activities / visits per month', type: 'number', min: 0 },
        { key: 'minutesPerActivity', label: 'RN minutes per activity', type: 'number', min: 0 },
        { key: 'supportHoursPerMonth', label: 'Additional uncovered support workload (hours/month)', type: 'number', min: 0, optional: true }
      ]
    },
    POSTS: {
      label: 'Fixed RN posts', section: 'OTHER',
      fields: [
        { key: 'rnPosts', label: 'Concurrent RN posts during opening hours', type: 'number', min: 0 }
      ]
    }
  };

  var RELATION_TYPES = ['', 'SUBSET_OF', 'POSSIBLE_DUPLICATE_OF'];
  var RELATION_RESOLUTIONS = ['UNRESOLVED', 'SEPARATE', 'EXCLUDE'];

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
  function bool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1' || v === 'Yes'; }
  function round2(n) { return n === null ? null : Math.round((n + (n >= 0 ? EPS : -EPS)) * 100) / 100; }
  function ceilSafe(n) { return n === null ? null : Math.ceil(n - 1e-7); }
  function sum(list, fn) { var t = 0; for (var i = 0; i < list.length; i++) { var v = fn(list[i]); if (v !== null && v !== undefined) t += v; } return t; }
  function normName(s) { return String(s || '').toLowerCase().replace(/[‒-―\-–—]/g, '-').replace(/\s+/g, ' ').trim(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

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
   * Hours per FTE. Two mutually exclusive modes:
   *  DEDUCT: available = scheduled − leave − training − other; FTE = hours ÷ available.
   *  UPLIFT: FTE = hours ÷ scheduled × (1 + uplift). Leave fields are ignored.
   * hoursPerFTE is the single divisor used everywhere (FTE and supply hours).
   */
  function hoursModel(settings, mi) {
    var s = settings || {};
    var weekly = num(s.contractedWeeklyHours);
    var override = num(s.scheduledHoursOverride);
    var days = mi ? mi.days : null;
    var scheduled = override !== null ? override : (weekly !== null && days ? weekly * days / 7 : null);
    var mode = s.fteMode === 'UPLIFT' ? 'UPLIFT' : 'DEDUCT';
    var leave = num(s.leaveHours) || 0, training = num(s.trainingHours) || 0, other = num(s.otherUnavailableHours) || 0;
    var uplift = (num(s.reliefUpliftPct) || 0) / 100;
    var out = {
      mode: mode, scheduledHours: scheduled, scheduledSource: override !== null ? 'Manual override' : 'Weekly hours × days ÷ 7',
      unavailableHours: mode === 'DEDUCT' ? leave + training + other : 0,
      availableHours: null, uplift: mode === 'UPLIFT' ? uplift : 0, hoursPerFTE: null, equivalentUpliftPct: null
    };
    if (scheduled === null) return out;
    if (mode === 'DEDUCT') {
      out.availableHours = scheduled - out.unavailableHours;
      out.hoursPerFTE = out.availableHours;
      if (out.availableHours > 0) out.equivalentUpliftPct = (scheduled / out.availableHours - 1) * 100;
    } else {
      out.availableHours = scheduled;
      out.hoursPerFTE = scheduled / (1 + uplift);
      out.equivalentUpliftPct = uplift * 100;
    }
    if (!(out.hoursPerFTE > 0)) out.hoursPerFTE = null;
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
  // Method calculations. Each returns { hours, missing[], lines[], ... }.
  // "hours" = required RN coverage hours for the month.
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
  function fmt(n) { return n === null || n === undefined ? '—' : (Math.round(n * 100) / 100).toString(); }

  var CALC = {
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
      lines.push('Coverage hours = ' + fmt(avgRN) + ' × ' + fmt(sch.hours) + ' open h (' + sch.detail + ')');
      var census = num(p.shiftCensus);
      var censusAssumed = census === null;
      if (censusAssumed) census = ceilSafe(occupied);
      var shiftRN = Math.max(ceilSafe(census / ppr), ceilSafe(minRN));
      return {
        hours: avgRN * sch.hours, missing: [], lines: lines, occupied: occupied, avgRN: avgRN,
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
      lines.push('Average RN coverage = MAX(' + fmt(ratioRN) + ', ' + minRN + ') = ' + fmt(avgRN));
      lines.push('Coverage hours = ' + fmt(avgRN) + ' × ' + fmt(sch.hours) + ' open h');
      return {
        hours: avgRN * sch.hours, missing: [], lines: lines, occupied: occupied, avgRN: avgRN, beds: beds,
        minApplied: minRN > ratioRN + EPS, shiftRN: Math.max(ceilSafe(shiftRNRaw), ceilSafe(minRN)),
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
      return { hours: inHours + emHours, missing: [], lines: lines, openHoursOverride: sch.hours + (em > 0 ? outside : 0) };
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
      var days = ctx.month.days, total = 0, open = 0;
      periods.forEach(function (per) {
        var wl = sum(work.filter(function (w) { return normName(w.period) === normName(per.name); }),
          function (w) { return num(w.casesPerMonth) * num(w.minutesPerCase) / 60; });
        var ph = num(per.hoursPerDay) * days;
        var minH = num(per.minRN) * ph;
        var req = Math.max(wl, minH);
        open += ph; total += req;
        lines.push(per.name + ': workload ' + fmt(wl) + ' h vs minimum ' + per.minRN + ' RN × ' + fmt(ph) + ' h = ' + fmt(minH) + ' h → ' + fmt(req) + ' h');
      });
      return { hours: total, missing: [], lines: lines, openHoursOverride: open };
    },
    DELIVERY: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var n = need(p, 'deliveriesPerMonth', 'Deliveries per month', missing);
      var h = need(p, 'rnHoursPerDelivery', 'RN hours per delivery', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN (concurrent)', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var other = (num(p.otherCasesPerMonth) || 0) * (num(p.minutesPerOtherCase) || 0) / 60;
      var wl = n * h + other;
      lines.push('Delivery workload = ' + n + ' × ' + h + ' h = ' + fmt(n * h) + ' h; other assessments ' + fmt(other) + ' h');
      return { hours: withMinimum(wl, minRN, sch.hours, lines), missing: [], lines: lines };
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
        var th = sets * tmin / 60;
        tech.hours = th; tech.requiredFTE = round2(th / ctx.hours.hoursPerFTE); tech.status = 'Calculated';
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
      var active = c * ut / 100, conc = active * rpc, rn = Math.max(conc, minRN);
      lines.push('Concurrent RN = ' + c + ' clinics × ' + ut + '% × ' + rpc + ' RN = ' + fmt(conc) + '; with minimum ' + minRN + ' → ' + fmt(rn));
      lines.push('Coverage hours = ' + fmt(rn) + ' × ' + fmt(sch.hours) + ' open h (' + sch.detail + ')');
      return { hours: rn * sch.hours, missing: [], lines: lines, minApplied: minRN > conc + EPS };
    },
    ACTIVITY: function (u, p, ctx, sch) {
      var missing = [], lines = [];
      var n = need(p, 'activitiesPerMonth', 'Activities per month', missing);
      var m = need(p, 'minutesPerActivity', 'RN minutes per activity', missing);
      var minRN = need(u, 'minRNPerShift', 'Minimum RN during opening hours', missing);
      missing = missing.concat(sch.missing);
      if (missing.length) return { hours: null, missing: missing, lines: lines };
      var support = num(p.supportHoursPerMonth) || 0;
      var wl = n * m / 60 + support;
      lines.push('Activity workload = ' + n + ' × ' + m + ' min ÷ 60 + ' + support + ' support h = ' + fmt(wl) + ' h');
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

  function validateState(state, ctx) {
    var list = [];
    var s = state.settings || {};
    SETTINGS_FIELDS.forEach(function (f) { checkField(list, f, s[f.key], 'Settings', '', ''); });
    if (!ctx.month) issue(list, 'error', 'Settings', 'Reporting month must be in YYYY-MM format.', '', 'reportingMonth');
    if (s.fteMode !== 'DEDUCT' && s.fteMode !== 'UPLIFT') issue(list, 'error', 'Settings', 'Choose exactly one FTE method (Deduct or Uplift).', '', 'fteMode');
    if (ctx.hours.scheduledHours !== null && !(ctx.hours.hoursPerFTE > 0)) {
      issue(list, 'error', 'Settings', 'Available coverage hours per FTE must be positive (scheduled hours minus leave, training and other unavailable hours).', '', 'leaveHours');
    }
    if (ctx.hours.scheduledHours === null) issue(list, 'error', 'Settings', 'Scheduled monthly hours cannot be calculated: enter weekly hours or an override.', '', 'contractedWeeklyHours');

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
      var hc = num(u.currentRNHeadcount), fte = num(u.currentRNFTE);
      if (hc !== null && hc < 0) issue(list, 'error', u.name, 'Current RN headcount cannot be negative.', u.id, 'currentRNHeadcount');
      if (hc !== null && Math.floor(hc) !== hc) issue(list, 'error', u.name, 'Current RN headcount must be a whole number.', u.id, 'currentRNHeadcount');
      if (fte !== null && fte < 0) issue(list, 'error', u.name, 'Current RN FTE cannot be negative.', u.id, 'currentRNFTE');
      if (fte !== null && hc !== null && fte > hc + EPS) issue(list, 'warning', u.name, 'Current RN FTE exceeds headcount — check contracts.', u.id, 'currentRNFTE');
      var minRN = num(u.minRNPerShift);
      if (minRN !== null && minRN < 0) issue(list, 'error', u.name, 'Minimum RN coverage cannot be negative.', u.id, 'minRNPerShift');
      var ot = num(u.otEligibleHeadcount);
      if (ot !== null && (ot < 0 || (hc !== null && ot > hc))) issue(list, 'error', u.name, 'Overtime-eligible headcount must be between 0 and current RN headcount.', u.id, 'otEligibleHeadcount');
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
      var ovr = num(u.manualOverrideFTE);
      if (!isBlank(u.manualOverrideFTE)) {
        if (ovr === null || ovr < 0) issue(list, 'error', u.name, 'Manual override FTE must be a non-negative number.', u.id, 'manualOverrideFTE');
        if (isBlank(u.manualOverrideReason)) issue(list, 'error', u.name, 'Manual override requires a reason.', u.id, 'manualOverrideReason');
      }
      // Method parameters (only the active method is validated and calculated).
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

    // CNC contributions: no duplicate employee capacity.
    var cncByRef = {}, cncPair = {};
    (state.cncContributions || []).forEach(function (c, i) {
      var tag = 'CNC row ' + (i + 1) + (c.cncRef ? ' (' + c.cncRef + ')' : '');
      ['totalHours', 'adminHours', 'directCareHours'].forEach(function (k) {
        var v = num(c[k]); if (v !== null && v < 0) issue(list, 'error', 'CNC', tag + ': hours cannot be negative.', c.unitId, k);
      });
      if (isBlank(c.cncRef)) { issue(list, 'error', 'CNC', tag + ': employee reference is required to prevent double counting.', c.unitId, 'cncRef'); return; }
      var tot = num(c.totalHours), adm = num(c.adminHours) || 0, dc = num(c.directCareHours) || 0;
      if (tot !== null && dc + adm > tot + EPS) issue(list, 'error', 'CNC', tag + ': direct-care + supervision/admin hours exceed total hours.', c.unitId, 'directCareHours');
      var pair = normName(c.cncRef) + '|' + c.unitId;
      if (cncPair[pair]) issue(list, 'error', 'CNC', tag + ': same CNC entered twice for the same unit.', c.unitId, 'cncRef');
      cncPair[pair] = true;
      cncByRef[normName(c.cncRef)] = (cncByRef[normName(c.cncRef)] || 0) + dc;
      var u = findUnit(state, c.unitId);
      if (!u) issue(list, 'error', 'CNC', tag + ': assigned unit not found.', c.unitId, 'unitId');
    });
    Object.keys(cncByRef).forEach(function (ref) {
      if (ctx.hours.hoursPerFTE && cncByRef[ref] > ctx.hours.hoursPerFTE + EPS) {
        issue(list, 'error', 'CNC', 'CNC ' + ref + ' is credited with ' + round2(cncByRef[ref]) + ' direct-care hours, more than one FTE (' + round2(ctx.hours.hoursPerFTE) + ' h) — duplicate capacity.', '', 'directCareHours');
      }
    });
    var cncCount = Object.keys(cncByRef).length, cncHC = num(s.cncHeadcount);
    if (cncHC !== null && cncCount > cncHC) issue(list, 'error', 'CNC', cncCount + ' CNCs have contributions but CNC headcount is ' + cncHC + '.', '', 'cncHeadcount');

    // Transfers: structural checks only; eligibility is evaluated in calculateTransfers.
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
  // Unit calculation
  // ---------------------------------------------------------------------------
  function calcUnit(u, ctx, cncHoursByUnit) {
    var hpf = ctx.hours.hoursPerFTE;
    var r = {
      id: u.id, name: u.name, section: u.section, method: u.method, methodLabel: METHODS[u.method] ? METHODS[u.method].label : u.method,
      isOpen: u.isOpen !== false && u.isOpen !== 'FALSE', status: null, missing: [], lines: [], notes: [],
      openHours: null, coverageHours: null, methodHours: null, avgConcurrentRN: null, requiredFTE: null, establishment: null,
      currentHC: num(u.currentRNHeadcount) || 0, currentFTE: null, currentFTEAssumed: false,
      cncHours: cncHoursByUnit[u.id] || 0, cncFTE: 0, effectiveFTE: null,
      netGap: null, shortage: null, surplus: null, shiftRN: null, shiftCensus: null, shiftCensusAssumed: false,
      occupied: null, counted: true, provisionalReasons: [], technicians: null
    };
    var fteIn = num(u.currentRNFTE);
    r.currentFTE = fteIn === null ? r.currentHC : fteIn;
    r.currentFTEAssumed = fteIn === null;
    if (r.currentFTEAssumed && r.currentHC > 0) r.notes.push('Current FTE assumed equal to headcount.');
    r.cncFTE = hpf ? round2(r.cncHours / hpf) : 0;
    r.effectiveFTE = round2(r.currentFTE + r.cncFTE);

    // Relations (subset / possible duplicate) decide whether the row is aggregated.
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
      r.status = STATUS.CLOSED; r.coverageHours = 0; r.requiredFTE = 0; r.establishment = 0; r.openHours = 0;
      r.lines.push('Unit closed: no minimum coverage requirement.');
    } else {
      var p = (u.params || {})[u.method] || {};
      var sch = scheduleHours(u, ctx.settings, ctx.month);
      var fn = CALC[u.method];
      var res = fn ? fn(u, p, ctx, sch) : { hours: null, missing: ['Workload method'], lines: [] };
      r.lines = res.lines || [];
      r.missing = res.missing || [];
      r.methodHours = res.hours;
      r.openHours = res.openHoursOverride !== undefined ? res.openHoursOverride : sch.hours;
      r.occupied = res.occupied === undefined ? null : res.occupied;
      r.shiftRN = res.shiftRN === undefined ? null : res.shiftRN;
      r.shiftCensus = res.shiftCensus === undefined ? null : res.shiftCensus;
      r.shiftCensusAssumed = !!res.shiftCensusAssumed;
      r.minApplied = !!res.minApplied;
      r.technicians = res.technicians || null;
      var ovr = num(u.manualOverrideFTE);
      if (ovr !== null && !isBlank(u.manualOverrideReason)) {
        r.status = STATUS.OVERRIDE;
        r.requiredFTE = round2(ovr);
        r.coverageHours = hpf ? ovr * hpf : null;
        r.notes.push('Manual override: ' + u.manualOverrideReason);
        if (res.hours !== null && hpf) r.notes.push('Method result would be ' + round2(res.hours / hpf) + ' FTE.');
      } else if (res.hours === null || !hpf) {
        r.status = STATUS.DATA;
        if (!hpf) r.missing.push('Valid hours per FTE (Settings)');
      } else {
        r.coverageHours = res.hours;
        r.requiredFTE = round2(res.hours / hpf);
      }
      if (r.requiredFTE !== null) r.establishment = ceilSafe(r.requiredFTE);
      if (r.coverageHours !== null && r.openHours) r.avgConcurrentRN = r.coverageHours / r.openHours;
      if (r.shiftRN === null && r.avgConcurrentRN !== null) r.shiftRN = ceilSafe(r.avgConcurrentRN);
    }
    if (r.requiredFTE !== null) {
      r.netGap = round2(r.effectiveFTE - r.requiredFTE);
      r.shortage = round2(Math.max(0, -r.netGap));
      r.surplus = round2(Math.max(0, r.netGap));
      if (!r.status) r.status = r.netGap < -EPS ? STATUS.GAP : STATUS.MET;
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Transfers: only confirmed, compatible transfers that do not create a
  // shortage in the source are counted. Evaluated in table order.
  // ---------------------------------------------------------------------------
  function calculateTransfers(state, byId) {
    var out = [], sent = {}, received = {};
    (state.transfers || []).forEach(function (t, i) {
      var r = { id: t.id, index: i, sourceUnitId: t.sourceUnitId, destUnitId: t.destUnitId, fte: num(t.fte),
        competencyConfirmed: bool(t.competencyConfirmed), coverageCompatible: bool(t.coverageCompatible), valid: false, reasons: [] };
      var src = byId[t.sourceUnitId], dst = byId[t.destUnitId];
      if (!src) r.reasons.push('Source unit missing or archived');
      if (!dst) r.reasons.push('Destination unit missing or archived');
      if (src && dst && src.id === dst.id) r.reasons.push('Source and destination are the same');
      if (!(r.fte > 0)) r.reasons.push('FTE must be greater than zero');
      if (!r.competencyConfirmed) r.reasons.push('Competency not confirmed');
      if (!r.coverageCompatible) r.reasons.push('Coverage compatibility not confirmed');
      if (src && !src.counted) r.reasons.push('Source is excluded from totals');
      if (dst && !dst.counted) r.reasons.push('Destination is excluded from totals');
      if (dst && !dst.isOpen) r.reasons.push('Destination unit is closed');
      if (src && src.requiredFTE === null) r.reasons.push('Source requirement unknown (Data Required)');
      if (src && src.requiredFTE !== null && r.fte > 0) {
        var already = sent[src.id] || 0;
        var rnAvailable = src.currentFTE - already;                // CNC contribution is not transferable
        var spare = src.effectiveFTE + (received[src.id] || 0) - already - src.requiredFTE;
        if (r.fte > rnAvailable + EPS) r.reasons.push('Source has only ' + round2(Math.max(0, rnAvailable)) + ' RN FTE left to transfer');
        if (r.fte > spare + EPS) r.reasons.push('Would create a shortage in the source (spare ' + round2(Math.max(0, spare)) + ' FTE)');
      }
      if (!r.reasons.length) {
        r.valid = true;
        sent[src.id] = (sent[src.id] || 0) + r.fte;
        received[dst.id] = (received[dst.id] || 0) + r.fte;
        if (dst.requiredFTE !== null && dst.effectiveFTE + received[dst.id] - (sent[dst.id] || 0) > dst.requiredFTE + EPS) {
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
    var ctx = { settings: settings, month: mi, hours: hours, unitIndex: {} };
    (state.units || []).forEach(function (u) { ctx.unitIndex[u.id] = u; });
    var issues = validateState({ settings: settings, units: state.units, transfers: state.transfers, cncContributions: state.cncContributions }, ctx);

    // Eligible CNC direct-care hours by unit (qualified, assigned, hours specified).
    var cncHoursByUnit = {}, cncRows = [];
    (state.cncContributions || []).forEach(function (c) {
      var dc = num(c.directCareHours), ok = true, why = [];
      if (!bool(c.qualified)) { ok = false; why.push('Qualification not confirmed'); }
      if (isBlank(c.unitId) || !ctx.unitIndex[c.unitId] || bool(ctx.unitIndex[c.unitId].archived)) { ok = false; why.push('No active unit assignment'); }
      if (!(dc > 0)) { ok = false; why.push('Direct-care hours not specified'); }
      if (isBlank(c.cncRef)) { ok = false; why.push('Employee reference missing'); }
      var tot = num(c.totalHours), adm = num(c.adminHours) || 0;
      if (tot !== null && dc !== null && dc + adm > tot + EPS) { ok = false; why.push('Hours inconsistent'); }
      if (ok) cncHoursByUnit[c.unitId] = (cncHoursByUnit[c.unitId] || 0) + dc;
      cncRows.push({ id: c.id, cncRef: c.cncRef, unitId: c.unitId, eligible: ok, reasons: why, directCareHours: ok ? dc : 0 });
    });

    var results = [], byId = {};
    activeUnits(state).forEach(function (u) {
      var r = calcUnit(u, ctx, cncHoursByUnit);
      results.push(r);
      if (r.counted) byId[r.id] = r;
    });

    var tr = calculateTransfers(state, byId);
    var otMax = num(settings.otMaxHoursPerRN);
    var otPct = num(settings.otEligiblePct); if (otPct === null) otPct = 100;
    results.forEach(function (r) {
      var u = ctx.unitIndex[r.id];
      r.transferOut = round2(tr.sent[r.id] || 0);
      r.transferIn = round2(tr.received[r.id] || 0);
      r.postTransferFTE = round2(r.effectiveFTE - r.transferOut + r.transferIn);
      if (r.requiredFTE === null) { r.postGap = null; r.remainingShortage = null; r.uncoveredHours = null; r.feasibleOT = null; return; }
      r.postGap = round2(r.postTransferFTE - r.requiredFTE);
      r.remainingShortage = round2(Math.max(0, -r.postGap));
      r.recruitPosts = ceilSafe(r.remainingShortage);
      var supply = hours.hoursPerFTE ? r.postTransferFTE * hours.hoursPerFTE : 0;
      r.supplyHours = supply;
      r.uncoveredHours = Math.max(0, (r.coverageHours || 0) - supply);
      if (r.uncoveredHours < 0.005) r.uncoveredHours = 0;
      var eligHC = num(u.otEligibleHeadcount);
      if (eligHC === null) eligHC = Math.floor(r.currentHC * otPct / 100 + EPS);
      r.otEligibleHC = eligHC;
      r.otCapacity = otMax === null ? null : eligHC * otMax;
      r.feasibleOT = otMax === null ? null : Math.min(r.uncoveredHours, r.otCapacity);
      r.uncoveredAfterOT = r.feasibleOT === null ? null : r.uncoveredHours - r.feasibleOT;
    });

    // Provisional reasons and summary.
    var counted = results.filter(function (r) { return r.counted; });
    var known = counted.filter(function (r) { return r.requiredFTE !== null; });
    var dataReq = counted.filter(function (r) { return r.status === STATUS.DATA; });
    var provisional = [];
    dataReq.forEach(function (r) { provisional.push(r.name + ': Data Required'); });
    counted.forEach(function (r) { r.provisionalReasons.forEach(function (x) { provisional.push(x); }); });
    var errors = issues.filter(function (x) { return x.level === 'error'; });
    if (errors.length) provisional.push(errors.length + ' validation error(s)');

    var sm = {
      currentRNHC: sum(counted, function (r) { return r.currentHC; }),
      currentRNFTE: round2(sum(counted, function (r) { return r.currentFTE; })),
      cncContributionFTE: round2(sum(counted, function (r) { return r.cncFTE; })),
      requiredRNFTE: round2(sum(known, function (r) { return r.requiredFTE; })),
      establishment: sum(known, function (r) { return r.establishment; }),
      currentFTEInDataRequiredUnits: round2(sum(dataReq, function (r) { return r.currentFTE; })),
      shortageFTE: round2(sum(known, function (r) { return r.shortage; })),
      surplusFTE: round2(sum(known, function (r) { return r.surplus; })),
      netGapFTE: round2(sum(known, function (r) { return r.netGap; })),
      confirmedTransferFTE: round2(sum(tr.rows, function (t) { return t.valid ? t.fte : 0; })),
      invalidTransfers: tr.rows.filter(function (t) { return !t.valid; }).length,
      recruitmentFTE: round2(sum(known, function (r) { return r.remainingShortage; })),
      recruitmentPosts: sum(known, function (r) { return r.recruitPosts; }),
      requiredCoverageHours: sum(known, function (r) { return r.coverageHours; }),
      uncoveredHours: sum(known, function (r) { return r.uncoveredHours; }),
      feasibleOTHours: otMax === null ? null : sum(known, function (r) { return r.feasibleOT; }),
      uncoveredAfterOTHours: otMax === null ? null : sum(known, function (r) { return r.uncoveredAfterOT; }),
      pcaHC: num(settings.pcaHeadcount) || 0,
      pcaFTE: num(settings.pcaFTE),
      cncHC: num(settings.cncHeadcount) || 0,
      cncFTE: num(settings.cncFTE),
      unitsTotal: results.length,
      unitsCounted: counted.length,
      unitsOpen: counted.filter(function (r) { return r.isOpen; }).length,
      unitsComplete: counted.filter(function (r) { return r.status === STATUS.MET || r.status === STATUS.GAP || r.status === STATUS.CLOSED; }).length,
      unitsDataRequired: dataReq.length,
      unitsOverride: counted.filter(function (r) { return r.status === STATUS.OVERRIDE; }).length,
      unitsExcluded: results.length - counted.length,
      provisional: provisional.length > 0,
      provisionalReasons: provisional
    };
    sm.totalWorkforceHC = sm.currentRNHC + sm.pcaHC + sm.cncHC;
    sm.completenessPct = sm.unitsCounted ? Math.round((sm.unitsCounted - sm.unitsDataRequired) / sm.unitsCounted * 100) : 100;
    sm.dataStatus = sm.unitsDataRequired ? 'Provisional — ' + sm.unitsDataRequired + ' unit(s) need data' : (provisional.length ? 'Provisional' : 'Complete');

    var checks = [
      check('Net gap = surpluses − shortages', sm.netGapFTE, round2(sm.surplusFTE - sm.shortageFTE)),
      check('Required RN FTE = sum of unit rows', sm.requiredRNFTE, round2(sum(known, function (r) { return r.requiredFTE; }))),
      check('Current RN headcount = sum of unit rows', sm.currentRNHC, sum(counted, function (r) { return r.currentHC; })),
      check('Total workforce = RN + PCA/PCT + CNC', sm.totalWorkforceHC, sm.currentRNHC + sm.pcaHC + sm.cncHC),
      check('Recruitment = shortages − confirmed transfers received by short units', sm.recruitmentFTE,
        round2(sum(known, function (r) { return Math.max(0, -(r.netGap + r.transferIn - r.transferOut)); }))),
      check('Transfers sent = transfers received', round2(sum(counted, function (r) { return r.transferOut; })), round2(sum(counted, function (r) { return r.transferIn; }))),
      check('Recruitment ≤ shortages (transfers only reduce need)', Math.min(sm.recruitmentFTE, sm.shortageFTE), sm.recruitmentFTE)
    ];

    return {
      version: VERSION, month: mi, hours: hours, settings: settings, units: results, transfers: tr.rows,
      cnc: cncRows, summary: sm, costs: calculateCosts(settings, sm, hours), issues: issues, checks: checks
    };
  }

  function check(label, a, b) {
    return { label: label, calculated: a, reported: b, ok: Math.abs((a || 0) - (b || 0)) < 0.011 };
  }

  function calculateCosts(s, sm, hours) {
    var cur = s.currencyLabel || '';
    function money(rate, qty) { var r = num(rate); return r === null ? null : r * qty; }
    var rn = num(s.costRNMonthly), ot = num(s.costOTPerHour), tmp = num(s.costTempPerHour);
    var hpf = hours.hoursPerFTE;
    var options = [
      { option: 'Confirmed transfers', quantity: sm.confirmedTransferFTE, unit: 'FTE',
        monthlyCost: 0, oneOffCost: money(s.costTransferPerFTE, sm.confirmedTransferFTE),
        costPerHour: 0, note: 'Redeploys existing RNs; no additional payroll. Only confirmed, compatible transfers counted.' },
      { option: 'Overtime (feasible only)', quantity: sm.feasibleOTHours, unit: 'hours',
        monthlyCost: sm.feasibleOTHours === null ? null : money(ot, sm.feasibleOTHours), costPerHour: ot,
        note: sm.feasibleOTHours === null ? 'Maximum overtime hours not entered — Data Required.' : 'Capped by eligible RN headcount × maximum hours. Does not solve every shortage.' },
      { option: 'Temporary staff (all uncovered hours)', quantity: sm.uncoveredHours, unit: 'hours',
        monthlyCost: money(tmp, sm.uncoveredHours), costPerHour: tmp, note: 'Uncovered hours after confirmed transfers.' },
      { option: 'Recruitment', quantity: sm.recruitmentFTE, unit: 'FTE',
        monthlyCost: money(rn, sm.recruitmentFTE), costPerHour: rn !== null && hpf ? rn / hpf : null,
        note: sm.recruitmentPosts + ' whole posts (rounded per unit).' }
    ];
    var current = [
      { category: 'RN', fte: sm.currentRNFTE, monthlyCost: money(rn, sm.currentRNFTE) },
      { category: 'CNC', fte: sm.cncFTE !== null ? sm.cncFTE : sm.cncHC, monthlyCost: money(s.costCNCMonthly, sm.cncFTE !== null ? sm.cncFTE : sm.cncHC) },
      { category: 'PCA/PCT', fte: sm.pcaFTE !== null ? sm.pcaFTE : sm.pcaHC, monthlyCost: money(s.costPCAMonthly, sm.pcaFTE !== null ? sm.pcaFTE : sm.pcaHC) }
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

  function newUnit(id, name, section, method) {
    var inpatient = section === 'INPATIENT';
    var u = {
      id: id, name: name || 'New unit', section: inpatient ? 'INPATIENT' : 'OTHER',
      method: method || (inpatient ? 'RATIO' : 'CLINIC'), isOpen: true, archived: false, sortOrder: 999,
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

  return {
    VERSION: VERSION, STATUS: STATUS, METHODS: METHODS, SETTINGS_FIELDS: SETTINGS_FIELDS,
    NON_FRIDAY_DAYS: NON_FRIDAY_DAYS, RELATION_TYPES: RELATION_TYPES, RELATION_RESOLUTIONS: RELATION_RESOLUTIONS,
    calculate: calculate, monthInfo: monthInfo, hoursModel: hoursModel, scheduleHours: scheduleHours,
    defaultSettings: defaultSettings, normalizeSettings: normalizeSettings, newUnit: newUnit, blankParams: blankParams,
    num: num, bool: bool, round2: round2, ceilSafe: ceilSafe, isBlank: isBlank, normName: normName, clone: clone
  };
}

var NwcCalc = NWC_ENGINE_FACTORY_();
