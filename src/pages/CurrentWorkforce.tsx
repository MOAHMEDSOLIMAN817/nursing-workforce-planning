import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users, ArrowRight } from 'lucide-react';
import { PageHeader, Section, KpiCard, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import {
  calcPhysicianUnit,
  physicianTotals,
  type PhysicianAssumptions,
} from '../services/workforceCalculator';
import { calcNurseUnit, nurseTotals } from '../services/nursingCalculator';
import { fmtInt } from '../lib/format';
import type { PhysicianUnit } from '../lib/types';

const STATUS_CLS: Record<string, string> = {
  SHORTAGE: 'bg-shortage/10 text-shortage',
  BALANCED: 'bg-balanced/10 text-balanced',
  SURPLUS: 'bg-surplus/10 text-surplus',
};

export function CurrentWorkforce() {
  const { physicianUnits, setPhysicianUnits, nurseUnits, settings } = useApp();

  const assumptions: PhysicianAssumptions = {
    coverageHoursPerDay: settings.coverageHoursPerDay,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    availableHoursPerFteMonth: settings.availableHoursPerFteMonth,
  };
  const aKey = `${assumptions.coverageHoursPerDay}|${assumptions.workingDaysPerMonth}|${assumptions.availableHoursPerFteMonth}`;

  const rows = useMemo(
    () => physicianUnits.map((u) => ({ unit: u, calc: calcPhysicianUnit(u, assumptions) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [physicianUnits, aKey],
  );
  const t = useMemo(() => physicianTotals(rows.map((r) => r.calc)), [rows]);
  const nurse = useMemo(
    () => nurseTotals(nurseUnits, nurseUnits.map((u) => calcNurseUnit(u, assumptions))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nurseUnits, aKey],
  );

  const updateFte = (id: string, currentFte: number) => {
    setPhysicianUnits(physicianUnits.map((u: PhysicianUnit) => (u.id === id ? { ...u, currentFte } : u)));
  };

  return (
    <div>
      <PageHeader
        title="Current Workforce"
        subtitle="Actual staffing on hand today, measured against the calculated requirement."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Physicians in Post" value={fmtInt(t.currentFte)} tone="teal" />
        <KpiCard label="Physicians Required" value={fmtInt(t.requiredHeadcount)} tone="purple" />
        <KpiCard label="Nurses in Post" value={fmtInt(nurse.currentFte)} tone="teal" hint="From Nurses Planning" />
        <KpiCard label="Nurses Required" value={fmtInt(nurse.requiredHeadcount)} tone="purple" hint="From Nurses Planning" />
      </div>

      <Section
        title="Physician Roster by Unit"
        description="Current FTE is editable here and stays in sync with Physicians Planning."
        right={
          <Link to="/physicians" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Edit staffing model <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No units defined" description="Add units in Physicians Planning." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                  <th className="py-2.5 pr-3 font-semibold">Unit</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Required HC</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Current FTE</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Gap</th>
                  <th className="py-2.5 pl-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ unit, calc }) => (
                  <tr key={unit.id}>
                    <td className="py-2.5 pr-3 font-semibold text-navy">{unit.unit}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-navy/80">{fmtInt(calc.requiredHeadcount)}</td>
                    <td className="py-2 px-3 text-right">
                      <input
                        type="number"
                        min={0}
                        value={Number.isFinite(unit.currentFte) && unit.currentFte !== 0 ? unit.currentFte : ''}
                        onChange={(e) => updateFte(unit.id, e.target.value === '' ? 0 : Number(e.target.value))}
                        placeholder="0"
                        aria-label={`Current FTE for ${unit.unit}`}
                        className="w-20 rounded-lg border border-primary/20 bg-primary/[0.04] px-2 py-1.5 text-right text-sm tabular-nums text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold tabular-nums">
                      <span className={calc.gap < 0 ? 'text-shortage' : calc.gap > 0 ? 'text-surplus' : 'text-balanced'}>
                        {calc.gap > 0 ? `+${calc.gap}` : calc.gap}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_CLS[calc.status]}`}>
                        {calc.status === 'BALANCED'
                          ? 'Balanced'
                          : calc.status === 'SHORTAGE'
                            ? `Shortage ${fmtInt(calc.shortage)}`
                            : `Surplus ${fmtInt(calc.surplus)}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-bold text-navy">
                  <td className="py-2.5 pr-3">Total</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmtInt(t.requiredHeadcount)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmtInt(t.currentFte)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    <span className={t.currentFte - t.requiredHeadcount < 0 ? 'text-shortage' : 'text-surplus'}>
                      {t.currentFte - t.requiredHeadcount > 0 ? '+' : ''}
                      {t.currentFte - t.requiredHeadcount}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <div className="mt-6">
        <Section title="Workforce Composition" description="Headcount split across the two clinical workforces.">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-navy/60">Physicians</span>
              <b className="text-navy">{fmtInt(t.currentFte)}</b>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-teal" />
              <span className="text-navy/60">Nurses</span>
              <b className="text-navy">{fmtInt(nurse.currentFte)}</b>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
