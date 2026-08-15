import { useMemo, useState } from 'react';
import { Plus, Trash2, Calculator, X, RotateCcw } from 'lucide-react';
import { PageHeader, Section, KpiCard } from '../components/ui';
import { useApp } from '../store/AppContext';
import { SEED_PHYSICIAN_UNITS } from '../store/storage';
import {
  calcPhysicianUnit,
  physicianTotals,
  type PhysicianAssumptions,
} from '../services/workforceCalculator';
import { validatePhysicianUnit } from '../lib/validation';
import { fmt, fmtInt, uid } from '../lib/format';
import type { PhysicianCalc, PhysicianUnit } from '../lib/types';

// Columns flagged as user-editable (highlighted in the UI). Everything else is
// derived by the calculation engine and shown read-only.
const STATUS_META: Record<PhysicianCalc['status'], { label: string; cls: string; dot: string }> = {
  SHORTAGE: { label: 'Shortage', cls: 'bg-shortage/10 text-shortage', dot: 'bg-shortage' },
  BALANCED: { label: 'Balanced', cls: 'bg-balanced/10 text-balanced', dot: 'bg-balanced' },
  SURPLUS: { label: 'Surplus', cls: 'bg-surplus/10 text-surplus', dot: 'bg-surplus' },
};

export function PhysiciansPlanning() {
  const { physicianUnits, setPhysicianUnits, settings } = useApp();
  const [detailId, setDetailId] = useState<string | null>(null);

  const assumptions: PhysicianAssumptions = {
    coverageHoursPerDay: settings.coverageHoursPerDay,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    availableHoursPerFteMonth: settings.availableHoursPerFteMonth,
  };

  const rows = useMemo(
    () =>
      physicianUnits.map((u) => ({
        unit: u,
        calc: calcPhysicianUnit(u, assumptions),
        errors: validatePhysicianUnit(u),
      })),
    [physicianUnits, assumptions.coverageHoursPerDay, assumptions.workingDaysPerMonth, assumptions.availableHoursPerFteMonth],
  );

  const totals = useMemo(() => physicianTotals(rows.map((r) => r.calc)), [rows]);
  const invalidCount = rows.filter((r) => Object.keys(r.errors).length > 0).length;

  const updateUnit = (id: string, patch: Partial<PhysicianUnit>) => {
    setPhysicianUnits(physicianUnits.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  const addUnit = () => {
    setPhysicianUnits([
      ...physicianUnits,
      { id: uid(), unit: 'New Unit', beds: 0, occupancyRate: 0, staffingRatio: 10, currentFte: 0 },
    ]);
  };

  const removeUnit = (id: string) => {
    if (detailId === id) setDetailId(null);
    setPhysicianUnits(physicianUnits.filter((u) => u.id !== id));
  };

  const resetDemo = () => {
    if (!confirm('Reset the physician units back to the demo list? Your edits will be lost.')) return;
    setPhysicianUnits(SEED_PHYSICIAN_UNITS.map((u) => ({ ...u, id: uid() })));
    setDetailId(null);
  };

  const detail = detailId ? rows.find((r) => r.unit.id === detailId) ?? null : null;

  return (
    <div>
      <PageHeader
        title="Physicians Planning"
        subtitle="Required physician headcount per clinical unit, driven by beds, occupancy and staffing ratio."
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
        description="Blue-tinted columns are editable. All other columns are calculated and read-only. Data is saved automatically."
        right={
          <div className="hidden items-center gap-3 text-xs text-navy/50 sm:flex">
            <LegendDot cls="bg-primary/15 border border-primary/30" label="Editable" />
            <LegendDot cls="bg-softbg border border-border" label="Calculated" />
          </div>
        }
      >
        {invalidCount > 0 && (
          <div className="mb-3 rounded-xl bg-shortage/10 px-4 py-2.5 text-xs font-semibold text-shortage">
            {invalidCount} unit{invalidCount === 1 ? ' has' : 's have'} invalid input — see highlighted cells below.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left">
                <Th sticky>Unit</Th>
                <Th editable>Beds</Th>
                <Th editable>Occ. %</Th>
                <Th>Occupied Beds</Th>
                <Th editable>Ratio (1:N)</Th>
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
                return (
                  <tr key={unit.id} className="group">
                    {/* Unit (editable, sticky) */}
                    <td className="sticky left-0 z-10 border-b border-border bg-white px-2 py-1.5 group-hover:bg-softbg/40">
                      <input
                        className={`w-36 rounded-lg border bg-primary/[0.04] px-2.5 py-1.5 text-sm font-semibold text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 ${
                          errors.unit ? 'border-shortage' : 'border-primary/20'
                        }`}
                        value={unit.unit}
                        onChange={(e) => updateUnit(unit.id, { unit: e.target.value })}
                        aria-label="Unit name"
                      />
                    </td>

                    <NumCell value={unit.beds} min={0} error={errors.beds} onChange={(n) => updateUnit(unit.id, { beds: n })} placeholder="e.g. 22" />
                    <NumCell value={unit.occupancyRate} min={0} max={100} error={errors.occupancyRate} onChange={(n) => updateUnit(unit.id, { occupancyRate: n })} placeholder="0-100" />

                    <CalcCell>{fmt(calc.occupiedBeds)}</CalcCell>

                    <NumCell value={unit.staffingRatio} min={1} error={errors.staffingRatio} onChange={(n) => updateUnit(unit.id, { staffingRatio: n })} placeholder="e.g. 10" />

                    <CalcCell>{fmt(calc.requiredPerShift)}</CalcCell>
                    <CalcCell>{fmt(calc.requiredHoursDay)}</CalcCell>
                    <CalcCell>{fmt(calc.requiredHoursMonth)}</CalcCell>
                    <CalcCell>{fmtInt(calc.availableHoursPerFte)}</CalcCell>
                    <CalcCell>{fmt(calc.baseRequiredFte)}</CalcCell>
                    <CalcCell strong>{fmtInt(calc.requiredHeadcount)}</CalcCell>

                    <NumCell value={unit.currentFte} min={0} error={errors.currentFte} onChange={(n) => updateUnit(unit.id, { currentFte: n })} placeholder="0" />

                    {/* Gap */}
                    <td className="border-b border-border px-3 py-1.5 text-right font-bold tabular-nums">
                      <span
                        className={
                          calc.gap < 0 ? 'text-shortage' : calc.gap > 0 ? 'text-surplus' : 'text-balanced'
                        }
                      >
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
                  <td colSpan={15} className="border-b border-border px-3 py-10 text-center text-sm text-navy/50">
                    No units yet. Use “Add Unit” to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {detail && (
        <CalculationModal
          unit={detail.unit}
          calc={detail.calc}
          assumptions={assumptions}
          onClose={() => setDetailId(null)}
        />
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
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  error?: string;
  placeholder?: string;
}) {
  return (
    <td className="border-b border-border px-2 py-1.5">
      <input
        type="number"
        min={min}
        max={max}
        // Blank display for zero keeps the grid clean and makes "empty" natural to type into.
        value={Number.isFinite(value) && value !== 0 ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        placeholder={placeholder}
        title={error}
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

/* ------------------------------ calc modal -------------------------------- */

function CalculationModal({
  unit,
  calc,
  assumptions,
  onClose,
}: {
  unit: PhysicianUnit;
  calc: PhysicianCalc;
  assumptions: PhysicianAssumptions;
  onClose: () => void;
}) {
  const steps = [
    { expr: `${fmt(unit.beds)} × ${fmt(unit.occupancyRate)}%`, eq: `${fmt(calc.occupiedBeds)}`, label: 'Occupied Beds' },
    { expr: `${fmt(calc.occupiedBeds)} ÷ ${fmt(unit.staffingRatio)}`, eq: `${fmt(calc.requiredPerShift)}`, label: 'Physicians / Shift' },
    { expr: `${fmt(calc.requiredPerShift)} × ${fmt(assumptions.coverageHoursPerDay)}`, eq: `${fmt(calc.requiredHoursDay)}`, label: 'Hours / Day' },
    { expr: `${fmt(calc.requiredHoursDay)} × ${fmt(assumptions.workingDaysPerMonth)}`, eq: `${fmt(calc.requiredHoursMonth)}`, label: 'Hours / Month' },
    { expr: `${fmt(calc.requiredHoursMonth)} ÷ ${fmtInt(assumptions.availableHoursPerFteMonth)}`, eq: `${fmt(calc.baseRequiredFte)}`, label: 'Base FTE' },
  ];
  const status = STATUS_META[calc.status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-navy">Calculation — {unit.unit}</h3>
            <p className="text-xs text-navy/50">Step-by-step audit trail for HR review.</p>
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
