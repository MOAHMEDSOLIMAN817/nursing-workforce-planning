import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, HeartPulse, Users } from 'lucide-react';
import { PageHeader, Section, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { calcPhysicianUnit, physicianTotals, type PhysicianAssumptions } from '../services/workforceCalculator';
import { calcNurseUnit, nurseTotals, type NurseAssumptions } from '../services/nursingCalculator';
import { fmtInt } from '../lib/format';

interface GapRow {
  key: string;
  name: string;
  workforce: 'Physician' | 'Nurse';
  requiredHeadcount: number;
  currentFte: number;
  shortage: number;
}

export function ExecutiveOverview() {
  const { physicianUnits, nurseUnits, settings } = useApp();

  const physAssume: PhysicianAssumptions = {
    coverageHoursPerDay: settings.coverageHoursPerDay,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    availableHoursPerFteMonth: settings.availableHoursPerFteMonth,
  };
  const nurseAssume: NurseAssumptions = physAssume;
  const aKey = `${settings.coverageHoursPerDay}|${settings.workingDaysPerMonth}|${settings.availableHoursPerFteMonth}`;

  const physRows = useMemo(
    () => physicianUnits.map((u) => ({ unit: u, calc: calcPhysicianUnit(u, physAssume) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [physicianUnits, aKey],
  );
  const nurseRows = useMemo(
    () => nurseUnits.map((u) => ({ unit: u, calc: calcNurseUnit(u, nurseAssume) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nurseUnits, aKey],
  );

  const physT = useMemo(() => physicianTotals(physRows.map((r) => r.calc)), [physRows]);
  const nurseT = useMemo(() => nurseTotals(nurseUnits, nurseRows.map((r) => r.calc)), [nurseUnits, nurseRows]);

  const totalRequired = physT.requiredHeadcount + nurseT.requiredHeadcount;
  const totalCurrent = physT.currentFte + nurseT.currentFte;
  const totalGap = totalCurrent - totalRequired;

  const topGaps = useMemo<GapRow[]>(() => {
    const rows: GapRow[] = [
      ...physRows
        .filter((r) => r.calc.status === 'SHORTAGE')
        .map((r) => ({
          key: 'p-' + r.unit.id,
          name: r.unit.unit,
          workforce: 'Physician' as const,
          requiredHeadcount: r.calc.requiredHeadcount,
          currentFte: r.calc.currentFte,
          shortage: r.calc.shortage,
        })),
      ...nurseRows
        .filter((r) => r.calc.status === 'SHORTAGE')
        .map((r) => ({
          key: 'n-' + r.unit.id,
          name: r.unit.unit,
          workforce: 'Nurse' as const,
          requiredHeadcount: r.calc.requiredHeadcount,
          currentFte: r.calc.currentFte,
          shortage: r.calc.shortage,
        })),
    ];
    return rows.sort((a, b) => b.shortage - a.shortage).slice(0, 8);
  }, [physRows, nurseRows]);

  const hasData =
    physT.requiredHeadcount > 0 || physT.currentFte > 0 || nurseT.requiredHeadcount > 0 || nurseT.currentFte > 0;

  return (
    <div>
      <PageHeader
        title="Executive Overview"
        subtitle="Consolidated physician and nursing workforce position across all clinical units."
      />

      {!hasData ? (
        <Section title="Get started">
          <EmptyState
            title="No staffing data yet"
            description="Enter beds, occupancy and current FTE in Physicians Planning and Nurses Planning — this overview populates automatically."
          />
        </Section>
      ) : (
        <div className="space-y-6">
          {/* Three workforce KPI groups */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <WorkforceGroup
              icon={<Stethoscope className="h-5 w-5" />}
              title="Physicians"
              to="/physicians"
              required={physT.requiredHeadcount}
              current={physT.currentFte}
              shortage={physT.shortage}
              accent="text-primary"
            />
            <WorkforceGroup
              icon={<HeartPulse className="h-5 w-5" />}
              title="Nurses"
              to="/nurses"
              required={nurseT.requiredHeadcount}
              current={nurseT.currentFte}
              shortage={nurseT.shortage}
              accent="text-teal"
            />
            <WorkforceGroup
              icon={<Users className="h-5 w-5" />}
              title="Total Workforce"
              required={totalRequired}
              current={totalCurrent}
              gap={totalGap}
              accent="text-navy"
            />
          </div>

          {/* Combined top gaps */}
          <Section title="Top Workforce Gaps" description="Largest shortages across physicians and nurses.">
            {topGaps.length === 0 ? (
              <div className="rounded-xl bg-balanced/10 px-4 py-6 text-center text-sm font-semibold text-balanced">
                No shortages — every unit is balanced or in surplus.
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {topGaps.map((g) => (
                  <li key={g.key} className="flex items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            g.workforce === 'Physician' ? 'bg-primary/10 text-primary' : 'bg-teal/10 text-teal'
                          }`}
                        >
                          {g.workforce}
                        </span>
                        <span className="truncate font-bold text-navy">{g.name}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-navy/55">
                        Required {fmtInt(g.requiredHeadcount)} · Current {fmtInt(g.currentFte)}
                      </div>
                    </div>
                    <span className="ml-3 shrink-0 rounded-full bg-shortage/10 px-3 py-1 text-xs font-bold text-shortage">
                      Shortage {fmtInt(g.shortage)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function WorkforceGroup({
  icon,
  title,
  to,
  required,
  current,
  shortage,
  gap,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  to?: string;
  required: number;
  current: number;
  shortage?: number;
  gap?: number;
  accent: string;
}) {
  const header = (
    <div className="mb-4 flex items-center gap-2">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-softbg ${accent}`}>{icon}</span>
      <h2 className="text-base font-bold text-navy">{title}</h2>
    </div>
  );
  return (
    <div className="card p-5">
      {to ? (
        <Link to={to} className="block transition hover:opacity-80">
          {header}
        </Link>
      ) : (
        header
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric label="Required" value={fmtInt(required)} tone={accent} />
        <Metric label="Current" value={fmtInt(current)} tone="text-navy" />
        {gap !== undefined ? (
          <Metric
            label="Gap"
            value={`${gap > 0 ? '+' : ''}${fmtInt(gap)}`}
            tone={gap < 0 ? 'text-shortage' : gap > 0 ? 'text-surplus' : 'text-balanced'}
          />
        ) : (
          <Metric label="Shortage" value={fmtInt(shortage ?? 0)} tone="text-shortage" />
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-2 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-navy/45">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold leading-none ${tone}`}>{value}</div>
    </div>
  );
}
