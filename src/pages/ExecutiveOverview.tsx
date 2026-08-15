import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, ArrowRight } from 'lucide-react';
import { PageHeader, Section, KpiCard, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import {
  calcPhysicianUnit,
  physicianTotals,
  type PhysicianAssumptions,
} from '../services/workforceCalculator';
import { latestPerDepartment, toSummary, totals as nurseTotals } from '../lib/aggregate';
import { fmtInt } from '../lib/format';

export function ExecutiveOverview() {
  const { physicianUnits, settings, records } = useApp();

  const assumptions: PhysicianAssumptions = {
    coverageHoursPerDay: settings.coverageHoursPerDay,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    availableHoursPerFteMonth: settings.availableHoursPerFteMonth,
  };

  const rows = useMemo(
    () => physicianUnits.map((u) => ({ unit: u, calc: calcPhysicianUnit(u, assumptions) })),
    [physicianUnits, assumptions.coverageHoursPerDay, assumptions.workingDaysPerMonth, assumptions.availableHoursPerFteMonth],
  );
  const t = useMemo(() => physicianTotals(rows.map((r) => r.calc)), [rows]);

  const topGaps = useMemo(
    () =>
      rows
        .filter((r) => r.calc.status === 'SHORTAGE')
        .sort((a, b) => b.calc.shortage - a.calc.shortage)
        .slice(0, 6),
    [rows],
  );

  const nurse = useMemo(() => nurseTotals(toSummary(latestPerDepartment(records))), [records]);
  const hasPlan = rows.some((r) => r.calc.requiredHeadcount > 0 || r.calc.currentFte > 0);

  return (
    <div>
      <PageHeader
        title="Executive Overview"
        subtitle="Consolidated physician workforce position across all clinical units."
        actions={
          <Link to="/physicians" className="btn-primary">
            <Stethoscope className="h-4 w-4" /> Open Physicians Planning
          </Link>
        }
      />

      {!hasPlan ? (
        <Section title="Get started">
          <EmptyState
            title="No physician staffing data yet"
            description="Open Physicians Planning, enter beds, occupancy and current FTE per unit, and this overview will populate automatically."
          />
        </Section>
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Total Required Physicians" value={fmtInt(t.requiredHeadcount)} tone="purple" />
            <KpiCard label="Current Physicians" value={fmtInt(t.currentFte)} tone="teal" />
            <KpiCard label="Total Shortage" value={fmtInt(t.shortage)} tone="shortage" />
            <KpiCard label="Total Surplus" value={fmtInt(t.surplus)} tone="surplus" />
            <KpiCard label="Units with Shortage" value={fmtInt(t.unitsWithShortage)} tone="attention" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Top workforce gaps */}
            <div className="lg:col-span-3">
              <Section title="Top Workforce Gaps" description="Units with the largest physician shortages.">
                {topGaps.length === 0 ? (
                  <div className="rounded-xl bg-balanced/10 px-4 py-6 text-center text-sm font-semibold text-balanced">
                    No physician shortages — every unit is balanced or in surplus.
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {topGaps.map(({ unit, calc }) => (
                      <li key={unit.id} className="flex items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate font-bold text-navy">{unit.unit}</div>
                          <div className="mt-0.5 text-xs text-navy/55">
                            Required {fmtInt(calc.requiredHeadcount)} · Current {fmtInt(calc.currentFte)}
                          </div>
                        </div>
                        <span className="ml-3 shrink-0 rounded-full bg-shortage/10 px-3 py-1 text-xs font-bold text-shortage">
                          Shortage {fmtInt(calc.shortage)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            {/* Coverage summary + nurse snapshot */}
            <div className="lg:col-span-2 space-y-6">
              <Section title="Physician Coverage" description="Current vs. required headcount.">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-extrabold text-navy">
                      {t.requiredHeadcount > 0 ? Math.round((t.currentFte / t.requiredHeadcount) * 100) : 0}%
                    </div>
                    <div className="mt-1 text-xs text-navy/50">of required physicians currently in post</div>
                  </div>
                  <div className="text-right text-sm text-navy/60">
                    <div>Current <b className="text-navy">{fmtInt(t.currentFte)}</b></div>
                    <div>Required <b className="text-navy">{fmtInt(t.requiredHeadcount)}</b></div>
                  </div>
                </div>
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-softbg">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${
                        t.requiredHeadcount > 0
                          ? Math.min(100, Math.round((t.currentFte / t.requiredHeadcount) * 100))
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </Section>

              <Section
                title="Nursing Snapshot"
                description="From the latest saved nurse plans."
                right={
                  <Link to="/nurses-dashboard" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    Details <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              >
                {records.length === 0 ? (
                  <p className="text-sm text-navy/50">No saved nurse plans yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <MiniKpi label="Current HC" value={fmtInt(nurse.currentHc)} />
                    <MiniKpi label="Required HC" value={fmtInt(nurse.requiredHc)} />
                    <MiniKpi label="Shortage" value={fmtInt(nurse.shortage)} tone="text-shortage" />
                    <MiniKpi label="Surplus" value={fmtInt(nurse.surplus)} tone="text-surplus" />
                  </div>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniKpi({ label, value, tone = 'text-navy' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/45">{label}</div>
      <div className={`mt-1 text-xl font-extrabold ${tone}`}>{value}</div>
    </div>
  );
}
