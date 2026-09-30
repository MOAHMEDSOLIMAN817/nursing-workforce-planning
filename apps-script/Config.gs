/**
 * Config.gs — sheet layout and initial (seed) data.
 *
 * Seed values come from "Nursing Manpower Calculator.xlsx" (units and current
 * RN staffing). Ratios, hours and minimums are PLANNING ASSUMPTIONS requiring
 * local approval — they are not mandatory clinical standards.
 *
 * Do not reference NwcCalc at top level here: Apps Script may load this file
 * before Calculations.gs.
 */
var APP_CONFIG = {
  APP_TITLE: 'Nursing Workforce Calculator',
  SCHEMA_VERSION: 4,
  SHEETS: {
    SETTINGS: 'Settings',
    UNITS: 'Units',
    TRANSFERS: 'Transfers',
    CONTRIB: 'Contributions',
    LEGACY_CNC: 'CNC_Contributions',
    RESULTS: 'Results',
    AUDIT: 'Audit_Log',
    META: '_Meta'
  },
  // Column headers per data sheet. Columns are read/written by header name,
  // so new columns can be appended without breaking saved data.
  COLUMNS: {
    Settings: ['key', 'value', 'label', 'updated_at'],
    Units: ['unit_id', 'name', 'section', 'unit_type', 'method', 'is_open', 'archived', 'sort_order',
      'current_rn_hc', 'current_rn_fte', 'min_rn_per_shift',
      'weekday_hours', 'open_days', 'friday_hours', 'holiday_hours',
      'manual_override_fte', 'manual_override_reason',
      'relation_type', 'related_unit_id', 'relation_resolution',
      'ot_eligible_hc', 'notes', 'params_json', 'updated_at', 'updated_by'],
    Transfers: ['transfer_id', 'source_unit_id', 'dest_unit_id', 'fte', 'competency_confirmed', 'coverage_compatible', 'notes', 'updated_at'],
    Contributions: ['allocation_id', 'category', 'staff_ref', 'unit_id', 'allocated_fte', 'contribution_pct', 'approved', 'counted_in_rn_fte', 'notes', 'updated_at'],
    // Version-1 sheet (hours-based CNC rows). Read once for migration, never written.
    CNC_Contributions: ['contribution_id', 'cnc_ref', 'unit_id', 'qualified', 'total_hours', 'admin_hours', 'direct_care_hours', 'notes', 'updated_at'],
    Audit_Log: ['timestamp', 'user', 'action', 'details'],
    _Meta: ['key', 'value']
  }
};

var ALL_DAYS_ = 'Sat,Sun,Mon,Tue,Wed,Thu';
var H24_ = { weekdayHours: 24, openDays: ALL_DAYS_, fridayHours: 24, holidayHours: 24 };

function seedInpatient_(id, name, beds, occ, ppr, rn, extra) {
  var u = {
    id: id, name: name, section: 'INPATIENT', unitType: 'INPATIENT', method: 'RATIO', isOpen: true, archived: false,
    currentRNHeadcount: rn, currentRNFTE: '', minRNPerShift: 1,
    schedule: JSON.parse(JSON.stringify(H24_)),
    manualOverrideFTE: '', manualOverrideReason: '',
    relation: { type: '', unitId: '', resolution: 'UNRESOLVED' },
    otEligibleHeadcount: '', notes: '',
    params: { RATIO: { beds: beds, occupancyPct: occ, patientsPerRN: ppr, shiftCensus: '' } }
  };
  if (extra) Object.keys(extra).forEach(function (k) { u[k] = extra[k]; });
  return u;
}

function seedOther_(id, name, method, rn, schedule, params, extra) {
  var TYPES = { DELIVERY: 'DELIVERY', OR: 'OR', ER: 'ER', CSSD: 'CSSD', PROCEDURE: 'PROCEDURE', POSTS: 'OTHER', CLINIC: 'OPD', ACTIVITY: 'OPD' };
  var u = {
    id: id, name: name, section: 'OTHER', unitType: TYPES[method], method: method, isOpen: true, archived: false,
    currentRNHeadcount: rn, currentRNFTE: '', minRNPerShift: '',
    schedule: schedule, manualOverrideFTE: '', manualOverrideReason: '',
    relation: { type: '', unitId: '', resolution: 'UNRESOLVED' },
    otEligibleHeadcount: '', notes: '', params: {}
  };
  u.params[method] = params;
  if (extra) Object.keys(extra).forEach(function (k) { u[k] = extra[k]; });
  return u;
}

/** Initial units. IDs are stable and must never be reused. */
function getSeedUnits_() {
  var sub = function (parent) { return { relation: { type: 'SUBSET_OF', unitId: parent, resolution: 'UNRESOLVED' },
    notes: 'Workbook lists this row separately. Confirm whether these are separate beds or a subset of the parent unit.' }; };
  var units = [
    seedInpatient_('U-PICU', 'PICU', 22, 73, 2, 32),
    seedInpatient_('U-NICU', 'NICU', 30, 75, 2, 45),
    seedInpatient_('U-NICU-VEN', 'NICU – Ventilated', 12, 75, 2, 18, sub('U-NICU')),
    seedInpatient_('U-NICU-ISO', 'NICU – Isolation', 10, 90, 2, 18, sub('U-NICU')),
    seedInpatient_('U-ICU', 'ICU', 27, 78, 2, 43),
    seedInpatient_('U-ICU-VEN', 'ICU – Ventilated', 9, 78, 2, 18, sub('U-ICU')),
    seedInpatient_('U-IMC', 'Intermediate Care', 24, 88, 3, 29),
    seedInpatient_('U-CCU', 'CCU', 5, 70, 2, 8),
    seedInpatient_('U-STROKE', 'Stroke Unit', 5, 70, 3, 5),
    seedInpatient_('U-W1-NS1', 'Ward – 1st Floor NS1', 21, 40, 6, 5),
    seedInpatient_('U-W2-NS1', 'Ward – 2nd Floor NS1', 30, 73, 6, 12),
    seedInpatient_('U-W2-NS2', 'Ward – 2nd Floor NS2', 26, 58, 6, 11),
    seedInpatient_('U-W3-NS1', 'Ward – 3rd Floor NS1', 6, 50, 6, 1),
    seedInpatient_('U-W3-NS2', 'Ward – 3rd Floor NS2', 14, 50, 6, 6),
    seedInpatient_('U-W3-NS3', 'Ward – 3rd Floor NS3', 24, 78, 6, 12)
  ];
  var dup = function (other) { return { relation: { type: 'POSSIBLE_DUPLICATE_OF', unitId: other, resolution: 'UNRESOLVED' } }; };
  var opd = { weekdayHours: 12, openDays: ALL_DAYS_, fridayHours: 0, holidayHours: 0 };
  var others = [
    seedOther_('U-DR-NU', 'Delivery Room – NU', 'DELIVERY', 8, JSON.parse(JSON.stringify(H24_)),
      { deliveriesPerMonth: '', rnHoursPerDelivery: '', otherCasesPerMonth: '', minutesPerOtherCase: '' },
      { relation: { type: 'POSSIBLE_DUPLICATE_OF', unitId: 'U-DR', resolution: 'UNRESOLVED' },
        notes: 'Workbook: 5 units, 80%, 1:3. Confirm whether DR and Delivery Room – NU are different services. Delivery volume required.' }),
    seedOther_('U-DR', 'DR', 'DELIVERY', 6, JSON.parse(JSON.stringify(H24_)),
      { deliveriesPerMonth: '', rnHoursPerDelivery: '', otherCasesPerMonth: '', minutesPerOtherCase: '' },
      { notes: 'Workbook: 5 units, 80%, 1:4. See Delivery Room – NU duplicate check. Delivery volume required.' }),
    seedOther_('U-OR', 'OR', 'OR', 23, { weekdayHours: '', openDays: ALL_DAYS_, fridayHours: '', holidayHours: '' },
      { rooms: 4, rnPerRoom: '', prepMinutesPerRoomDay: '', prepIncluded: false, recoveryRN: '', recoveryIncluded: false, emergencyRN: '', emergencyIncluded: false },
      { notes: 'Workbook sized OR by bed ratio (4 × 80% ÷ 5) — replaced by rooms × operating hours × RN roles. Operating hours and roles required.' }),
    seedOther_('U-ER', 'ER', 'ER', 18, JSON.parse(JSON.stringify(H24_)),
      { periods: [{ name: 'Day (07–19)', hoursPerDay: 12, minRN: '' }, { name: 'Night (19–07)', hoursPerDay: 12, minRN: '' }],
        workload: [
          { period: 'Day (07–19)', acuity: 'High (ESI 1–2)', casesPerMonth: '', minutesPerCase: '' },
          { period: 'Day (07–19)', acuity: 'Medium (ESI 3)', casesPerMonth: '', minutesPerCase: '' },
          { period: 'Day (07–19)', acuity: 'Low (ESI 4–5)', casesPerMonth: '', minutesPerCase: '' },
          { period: 'Night (19–07)', acuity: 'High (ESI 1–2)', casesPerMonth: '', minutesPerCase: '' },
          { period: 'Night (19–07)', acuity: 'Medium (ESI 3)', casesPerMonth: '', minutesPerCase: '' },
          { period: 'Night (19–07)', acuity: 'Low (ESI 4–5)', casesPerMonth: '', minutesPerCase: '' }
        ] },
      { notes: 'Workbook used 25 beds × 60% ÷ 3 — bed occupancy alone is insufficient for ER. Attendance by period and acuity required.' }),
    seedOther_('U-CSSD', 'CSSD', 'CSSD', 4, { weekdayHours: '', openDays: ALL_DAYS_, fridayHours: '', holidayHours: '' },
      { rnPosts: '', setsPerMonth: '', techMinutesPerSet: '', currentTechnicians: '' },
      { notes: 'Workbook recorded 0 units. Instrument-set workload and RN posts required. Technicians are not RN posts.' }),
    seedOther_('U-ENDO', 'Endoscopy', 'PROCEDURE', 2, { weekdayHours: '', openDays: ALL_DAYS_, fridayHours: 0, holidayHours: 0 },
      { proceduresPerMonth: '', procedureMinutes: '', rnPerProcedure: '', prepMinutesPerProcedure: '', recoveryMinutesPerPatient: '', patientsPerRecoveryRN: '', recoveryIncluded: false },
      { notes: 'Workbook combined "Endoscopy / Cathlab" with 2 current RN, all placed here. Confirm the split.' }),
    seedOther_('U-CATH', 'Cathlab', 'PROCEDURE', 0, { weekdayHours: '', openDays: ALL_DAYS_, fridayHours: 0, holidayHours: 0 },
      { proceduresPerMonth: '', procedureMinutes: '', rnPerProcedure: '', prepMinutesPerProcedure: '', recoveryMinutesPerPatient: '', patientsPerRecoveryRN: '', recoveryIncluded: false },
      { notes: 'Separated from Endoscopy. Current RN split to be confirmed.' }),
    seedOther_('U-ANES', 'Anesthesia – NU', 'POSTS', 4, { weekdayHours: '', openDays: ALL_DAYS_, fridayHours: '', holidayHours: '' },
      { rnPosts: '' },
      { notes: 'Omitted from the workbook overtime/other totals. Theatre hours and case volume required.' }),
    seedOther_('U-OPD-SURG', 'OPD – Surgical', 'CLINIC', 43, JSON.parse(JSON.stringify(opd)),
      { clinics: 70, utilisationPct: 70, rnPerClinic: 0.5 },
      { minRNPerShift: 1, notes: 'From workbook: 70 clinics, 70% active, 1 RN per 2 clinics, 12 h/day. Friday closed is an assumption — confirm.' }),
    seedOther_('U-OPD-MED', 'OPD – Medical', 'CLINIC', 21, JSON.parse(JSON.stringify(opd)),
      { clinics: 30, utilisationPct: 70, rnPerClinic: 0.25 },
      { minRNPerShift: 1, notes: 'From workbook: 30 clinics, 70% active, 1 RN per 4 clinics. Workbook mixed 24 h and 12 h — 12 h used; confirm.' })
  ];
  // Reference size (beds / rooms / units) from the workbook for manual units.
  var cap = getWorkbookCapacity_();
  others.forEach(function (u) { if (u.method !== 'CLINIC') u.params.MANUAL = { capacity: cap[u.id] === undefined ? '' : cap[u.id], requiredFTE: '' }; });
  var all = units.concat(others);
  all.forEach(function (u, i) { u.sortOrder = i + 1; });
  return all;
}

/**
 * "Operational Beds / Units" from the workbook for Other units (reference only).
 * Endoscopy / Cathlab were one row (5) — placed on Endoscopy. CSSD had no reliable figure.
 */
function getWorkbookCapacity_() {
  return { 'U-DR-NU': 5, 'U-DR': 5, 'U-OR': 4, 'U-ER': 25, 'U-ENDO': 5, 'U-ANES': 5 };
}
