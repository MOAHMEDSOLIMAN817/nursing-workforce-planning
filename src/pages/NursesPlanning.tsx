import { useMemo, useState } from 'react';
import { Plus, Trash2, Calculator, X, RotateCcw, Search } from 'lucide-react';
import { PageHeader, Section, KpiCard } from '../components/ui';
import { useApp } from '../store/AppContext';
import { SEED_NURSE_UNITS } from '../store/storage';
import {
  calcNurseUnit,
  modelForType,
  nurseTotals,
  type NurseAssumptions,
} from '../services/nursingCalculator';
import { validateNurseUnit } from '../lib/validation';
import { fmt, fmtInt, uid } from '../lib/format';
import type { NurseCalc, NurseUnit, NurseUnitType } from '../lib/types';

const UNIT_TYPES: NurseUnitType[] = [
  'Critical Care',
  'Inpatient Ward',
  'Clinic',
  'Emergency',
  'Operating Room',
  'Procedure Unit',
  'Delivery Room',
  'Other',
];

const STATUS_META: Record<NurseCalc['status'], { label: string; cls: string; dot: string }> = {
  SHORTAGE: { label: 'Shortage', cls: 'bg-shortage/10 text-shortage', dot: 'bg-shortage' },
  BALANCED: { label: 'Balanced', cls: 'bg-balanced/10 text-balanced', dot: 'bg-balanced' },
  SURPLUS: { label: 'Surplus', cls: 'bg-surplus/10 text-surplus', dot: 'bg-surplus' },
};

type ModelFilter = 'ALL' | 'Inpatient' | 'Clinic';

export function NursesPlanning() {
  const { nurseUnits, setNurseUnits, settings } = useApp();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('ALL');

  const assumptions: NurseAssumptions = {
    coverageHoursPerDay: settings.coverageHoursPerDay,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    availableHoursPerFteMonth: settings.availableHoursPerFteMonth,
  };
  const aKey = `${assumptions.coverageHoursPerDay}|${assumptions.workingDaysPerMonth}|${assumptions.availableHoursPerFteMonth}`;

  // Full result set (used for grand totals — always all units).
  const allRows = useMemo(
    () => nurseUnits.map((u) => ({ unit: u, calc: calcNurseUnit(u, assumptions), errors: validateNurseUnit(u) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nurseUnits, aKey],
  );
  const totals = useMemo(() => nurseTotals(nurseUnits, allRows.map((r) => r.calc)), [nurseUnits, allRows]);

  // Filtered view for the table.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(
      ({ unit }) =>
        (modelFilter === 'ALL' || unit.model === modelFilter) &&
        (q === '' || unit.unit.toLowerCase().includes(q) || unit.unitType.toLowerCase().includes(q)),
    );
  }, [allRows, query, modelFilter]);

  const invalidCount = allRows.filter((r) => Object.keys(r.errors).length > 0).length;
  const netGap = totals.currentFte - totals.requiredHeadcount;

  const updateUnit = (id: string, patch: Partial<NurseUnit>) => {
    setNurseUnits(nurseUnits.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  // Changing the unit type re-derives which staffing model (and therefore which
  // formula) the unit uses.
  const changeType = (id: string, unitType: NurseUnitType) => {
    updateUnit(id, { unitType, model: modelForType(unitType) });
  };

  const addUnit = () => {
    setNurseUnits([
      ...nurseUnits,
      {
        id: uid(),
        unit: 'New Unit',
        unitType: 'Inpatient Ward',
        model: 'Inpatient',
        beds: 0,
        occupancyRate: 0,
        staffingRatio: 2,
        clinics: 0,
        nursesPerClinic: 1,
        operatingHoursPerDay: 10,
        clinicWorkingDays: 26,
        currentFte: 0,
      },
    ]);
  };

  const removeUnit = (id: string) => {
    if (detailId === id) setDetailId(null);
    setNurseUnits(nurseUnits.filter((u) => u.id !== id));
  };

  const resetDemo = () => {
    if (!confirm('Reset nursing units back to the demo list? Your edits will be lost.')) return;
    setNurseUnits(SEED_NURSE_UNITS.map((u) => ({ ...u, id: uid() })));
    setDetailId(null);
  };

  const detail = detailId ? allRows.find((r) => r.unit.id === detailId) ?? null : null;

  return (
    <div>
      <PageHeader
        title="Nurses Planning"
        subtitle="Required nursing headcount per unit. Inpatient units use bed occupancy; clinics use session hours — each unit keeps its own staffing ratio."
        actions={
          <>
            <button className="btn-ghost" onClick={resetDemo}>
              <RotateCcw className="h-4 w-4" /> Reset demo
            </button>
            <button className="btn-primary" onClick={addUnit}>
              <Plus className="h-4 w-4" /> Add Unit
            </button>
          </>
        }
      />

      {/* Summary strip */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Required" value={fmtInt(totals.requiredHeadcount)} tone="purple" hint="Sum of required headcount" />
        <KpiCard label="Total Current FTE" value={fmtInt(totals.currentFte)} tone="teal" />
        <KpiCard label="Total Shortage" value={fmtInt(totals.shortage)} tone="shortage" />
        <KpiCard label="Units in Shortage" value={fmtInt(totals.unitsWithShortage)} tone="attention" />
      </div>

      <Section
        title="Unit Staffing Table"
        description="Blue-tinted cells are editable and adapt to the unit model. Grey cells are calculated and read-only. Changes save automatically."
        right={
          <div className="hidden items-center gap-3 text-xs text-navy/50 sm:flex">
            <LegendDot cls="bg-primary/15 border border-primary/30" label="Editable" />
            <LegendDot cls="bg-softbg border border-border" label="Calculated" />
          </div>
        }
      >
        {/* Controls */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/40" />
            <input
              className="input !w-64 !py-2 !pl-9"
              placeholder="Search unit or type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-softbg p-1 text-xs font-semibold">
            {(['ALL', 'Inpatient', 'Clinic'] as ModelFilter[]).map((m) => (
              <button
                key={m}
                onClick={() => setModelFilter(m)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  modelFilter === m ? 'bg-white text-primary shadow-soft' : 'text-navy/55 hover:text-navy'
                }`}
              >
                {m === 'ALL' ? 'All' : m}
              </button>
            ))}
          </div>
          <span className="text-xs text-navy/45">
            {rows.length} of {allRows.length} units
          </span>
        </div>

        {invalidCount > 0 && (
          <div className="mb-3 rounded-xl bg-shortage/10 px-4 py-2.5 text-xs font-semibold text-shortage">
            {invalidCount} unit{invalidCount === 1 ? ' has' : 's have'} invalid input — see highlighted cells.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left">
                <Th sticky>Unit</Th>
                <Th editable>Unit Type</Th>
                <Th editable>Beds / Clinics</Th>
                <Th editable>Occ % · Op Hrs</Th>
                <Th>Occ. Beds · Days</Th>
                <Th editable>Ratio · Nur/Clinic</Th>
                <Th>Req. / Shift</Th>
                <Th>Hrs / Day</Th>
                <Th>Hrs / Month</Th>
                <Th>Avail Hrs / FTE</Th>
                <Th>Base FTE</Th>
                <Th>Req. HC</Th>
                <Th editable>Current FTE</Th>
                <Th>Gap</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ unit, calc, errors }) => {
                const status = STATUS_META[calc.status];
                const isInpatient = unit.model === 'Inpatient';
                return (
                  <tr key={unit.id} className="group">
                    {/* Unit (editable, sticky) */}
                    <td className="sticky left-0 z-10 border-b border-border bg-white px-2 py-1.5 group-hover:bg-softbg/40">
                      <input
                        className={`w-40 rounded-lg border bg-primary/[0.04] px-2.5 py-1.5 text-sm font-semibold text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 ${
                          errors.unit ? 'border-shortage' : 'border-primary/20'
                        }`}
                        value={unit.unit}
                        onChange={(e) => updateUnit(unit.id, { unit: e.target.value })}
                        aria-label="Unit name"
                      />
                    </td>

                    {/* Unit type */}
                    <td className="border-b border-border px-2 py-1.5">
                      <select
                        className="w-36 rounded-lg border border-primary/20 bg-primary/[0.04] px-2 py-1.5 text-sm text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                        value={unit.unitType}
                        onChange={(e) => changeType(unit.id, e.target.value as NurseUnitType)}
                        aria-label="Unit type"
                      >
                        {UNIT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Beds / Clinics */}
                    {isInpatient ? (
                      <NumCell value={unit.beds} min={0} error={errors.beds} onChange={(n) => updateUnit(unit.id, { beds: n })} placeholder="beds" />
                    ) : (
                      <NumCell value={unit.clinics} min={0} error={errors.clinics} onChange={(n) => updateUnit(unit.id, { clinics: n })} placeholder="clinics" />
                    )}

                    {/* Occupancy % / Operating hours */}
                    {isInpatient ? (
                      <NumCell value={unit.occupancyRate} min={0} max={100} error={errors.occupancyRate} onChange={(n) => updateUnit(unit.id, { occupancyRate: n })} placeholder="0-100" title="Occupancy %" />
                    ) : (
                      <NumCell value={unit.operatingHoursPerDay} min={0} error={errors.operatingHoursPerDay} onChange={(n) => updateUnit(unit.id, { operatingHoursPerDay: n })} placeholder="hrs/day" title="Operating hours per day" />
                    )}

                    {/* Occupied Beds (calc) / Working days (clinic input) */}
                    {isInpatient ? (
                      <CalcCell>{fmt(calc.occupiedBeds)}</CalcCell>
                    ) : (
                      <NumCell value={unit.clinicWorkingDays} min={0} error={errors.clinicWorkingDays} onChange={(n) => updateUnit(unit.id, { clinicWorkingDays: n })} placeholder="days/mo" title="Working days per month" />
                    )}

                    {/* Ratio / Nurses per clinic */}
                    {isInpatient ? (
                      <NumCell value={unit.staffingRatio} min={1} error={errors.staffingRatio} onChange={(n) => updateUnit(unit.id, { staffingRatio: n })} placeholder="1:N" title="Patients per nurse" />
                    ) : (
                      <NumCell value={unit.nursesPerClinic} min={0} error={errors.nursesPerClinic} onChange={(n) => updateUnit(unit.id, { nursesPerClinic: n })} placeholder="nurses" title="Nurses per clinic" />
                    )}

                    <CalcCell>{fmt(calc.requiredPerShift)}</CalcCell>
                    <CalcCell>{fmt(calc.requiredHoursDay)}</CalcCell>
                    <CalcCell>{fmt(calc.requiredHoursMonth)}</CalcCell>
                    <CalcCell>{fmtInt(calc.availableHoursPerFte)}</CalcCell>
                    <CalcCell>{fmt(calc.baseRequiredFte)}</CalcCell>
                    <CalcCell strong>{fmtInt(calc.requiredHeadcount)}</CalcCell>

                    <NumCell value={unit.currentFte} min={0} error={errors.currentFte} onChange={(n) => updateUnit(unit.id, { currentFte: n })} placeholder="0" />

                    {/* Gap */}
                    <td className="border-b border-border px-3 py-1.5 text-right font-bold tabular-nums">
                      <span className={calc.gap < 0 ? 'text-shortage' : calc.gap > 0 ? 'text-surplus' : 'text-balanced'}>
                        {calc.gap > 0 ? `+${calc.gap}` : calc.gap}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="border-b border-border px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${status.cls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                        {calc.status === 'BALANCED'
                          ? 'Balanced'
                          : `${status.label} ${calc.status === 'SHORTAGE' ? calc.shortage : calc.surplus}`}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="border-b border-border px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-softbg"
                          onClick={() => setDetailId(unit.id)}
                          title="View calculation"
                        >
                          <Calculator className="h-3.5 w-3.5" /> View
                        </button>
                        <button
                          className="rounded-lg p-1.5 text-navy/40 hover:bg-shortage/10 hover:text-shortage"
                          onClick={() => removeUnit(unit.id)}
                          title="Remove unit"
                          aria-label={`Remove ${unit.unit}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={16} className="border-b border-border px-3 py-10 text-center text-sm text-navy/50">
                    No units match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Grand total */}
      <div className="mt-6">
        <Section title="Grand Total" description="Aggregated across all nursing units. Percentages and staffing ratios are never summed.">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <TotalCard label="Total Capacity" value={fmtInt(totals.capacity)} hint="Beds + clinics" />
            <TotalCard label="Total Required FTE" value={fmt(totals.baseRequiredFte)} hint="Full precision" />
            <TotalCard label="Total Required Headcount" value={fmtInt(totals.requiredHeadcount)} tone="text-primary" />
            <TotalCard label="Total Current FTE" value={fmtInt(totals.currentFte)} tone="text-teal" />
            <TotalCard
              label="Net Gap"
              value={`${netGap > 0 ? '+' : ''}${netGap}`}
              tone={netGap < 0 ? 'text-shortage' : netGap > 0 ? 'text-surplus' : 'text-balanced'}
            />
          </div>
        </Section>
      </div>

      {detail && (
        <NurseCalcModal unit={detail.unit} calc={detail.calc} assumptions={assumptions} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

/* ---------------------------------- cells --------------------------------- */

function Th({ children, editable, right, sticky }: { children: React.ReactNode; editable?: boolean; right?: boolean; sticky?: boolean }) {
  return (
    <th
      className={`border-b border-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${
        right ? 'text-right' : 'text-left'
      } ${sticky ? 'sticky left-0 z-20 bg-white' : ''} ${editable ? 'text-primary' : 'text-navy/50'}`}
    >
      {children}
    </th>
  );
}

function CalcCell({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <td className={`border-b border-border bg-softbg/30 px-3 py-1.5 text-right tabular-nums ${strong ? 'font-bold text-primary' : 'text-navy/80'}`}>
      {children}
    </td>
  );
}

function NumCell({
  value,
  onChange,
  min,
  max,
  error,
  placeholder,
  title,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  error?: string;
  placeholder?: string;
  title?: string;
}) {
  return (
    <td className="border-b border-border px-2 py-1.5">
      <input
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(value) && value !== 0 ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        placeholder={placeholder}
        title={error ?? title}
        className={`w-20 rounded-lg border bg-primary/[0.04] px-2 py-1.5 text-right text-sm tabular-nums text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 ${
          error ? 'border-shortage bg-shortage/5' : 'border-primary/20'
        }`}
      />
    </td>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-4 rounded ${cls}`} />
      {label}
    </span>
  );
}

function TotalCard({ label, value, hint, tone = 'text-navy' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/45">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-navy/40">{hint}</div>}
    </div>
  );
}

/* ------------------------------ calc modal -------------------------------- */

function NurseCalcModal({
  unit,
  calc,
  assumptions,
  onClose,
}: {
  unit: NurseUnit;
  calc: NurseCalc;
  assumptions: NurseAssumptions;
  onClose: () => void;
}) {
  const steps =
    unit.model === 'Inpatient'
      ? [
          { expr: `${fmt(unit.beds)} × ${fmt(unit.occupancyRate)}%`, eq: fmt(calc.occupiedBeds), label: 'Occupied Beds' },
          { expr: `${fmt(calc.occupiedBeds)} ÷ ${fmt(unit.staffingRatio)}`, eq: fmt(calc.requiredPerShift), label: 'Nurses / Shift' },
          { expr: `${fmt(calc.requiredPerShift)} × ${fmt(assumptions.coverageHoursPerDay)}`, eq: fmt(calc.requiredHoursDay), label: 'Hours / Day' },
          { expr: `${fmt(calc.requiredHoursDay)} × ${fmt(assumptions.workingDaysPerMonth)}`, eq: fmt(calc.requiredHoursMonth), label: 'Hours / Month' },
          { expr: `${fmt(calc.requiredHoursMonth)} ÷ ${fmtInt(assumptions.availableHoursPerFteMonth)}`, eq: fmt(calc.baseRequiredFte), label: 'Base FTE' },
        ]
      : [
          { expr: `${fmt(unit.clinics)} × ${fmt(unit.nursesPerClinic)}`, eq: fmt(calc.requiredPerShift), label: 'Nurses (clinics × per clinic)' },
          { expr: `${fmt(calc.requiredPerShift)} × ${fmt(unit.operatingHoursPerDay)}`, eq: fmt(calc.requiredHoursDay), label: 'Hours / Day' },
          { expr: `${fmt(calc.requiredHoursDay)} × ${fmt(unit.clinicWorkingDays)}`, eq: fmt(calc.requiredHoursMonth), label: 'Hours / Month' },
          { expr: `${fmt(calc.requiredHoursMonth)} ÷ ${fmtInt(assumptions.availableHoursPerFteMonth)}`, eq: fmt(calc.baseRequiredFte), label: 'Base FTE' },
        ];
  const status = STATUS_META[calc.status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-navy">Calculation — {unit.unit}</h3>
            <p className="text-xs text-navy/50">
              {unit.unitType} · {unit.model} model · step-by-step audit trail
            </p>
          </div>
          <button className="rounded-lg p-1.5 text-navy/50 hover:bg-softbg" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl bg-softbg/50 px-4 py-2.5 text-sm">
                <span className="font-mono text-navy/70">
                  {s.expr} = <b className="text-navy">{s.eq}</b>
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-navy/45">{s.label}</span>
              </li>
            ))}
            <li className="flex items-center justify-between rounded-xl bg-primary/[0.06] px-4 py-2.5 text-sm">
              <span className="font-mono text-navy/70">
                CEILING({fmt(calc.baseRequiredFte)}) = <b className="text-primary">{fmtInt(calc.requiredHeadcount)}</b>
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">Required Headcount</span>
            </li>
          </ol>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <MiniStat label="Required HC" value={fmtInt(calc.requiredHeadcount)} />
            <MiniStat label="Current FTE" value={fmtInt(calc.currentFte)} />
            <div className="rounded-xl border border-border px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/45">Status</div>
              <div className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${status.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {calc.status === 'BALANCED'
                  ? 'Balanced'
                  : `${status.label} ${calc.status === 'SHORTAGE' ? calc.shortage : calc.surplus}`}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/45">{label}</div>
      <div className="mt-1 text-lg font-extrabold text-navy">{value}</div>
    </div>
  );
}
