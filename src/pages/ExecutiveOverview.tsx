import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, HeartPulse, Users } from 'lucide-react';
import { PageHeader, Section, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { buildRoster, rosterTotals, topShortages, type RosterAssumptions, type TypeTotals } from '../services/workforceRoster';
import { fmt, fmtInt } from '../lib/format';

export function ExecutiveOverview() {
  const { physicianUnits, nurseUnits, settings } = useApp();

  const assumptions: RosterAssumptions = {
    coverageHoursPerDay: settings.coverageHoursPerDay,
    workingDaysPerMonth: settings.workingDaysPerMonth,
    availableHoursPerFteMonth: settings.availableHoursPerFteMonth,
  };
  const aKey = `${assumptions.coverageHoursPerDay}|${assumptions.workingDaysPerMonth}|${assumptions.availableHoursPerFteMonth}`;

  const roster = useMemo(
    () => buildRoster(physicianUnits, nurseUnits, assumptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [physicianUnits, nurseUnits, aKey],
  );
  const t = useMemo(() => rosterTotals(roster), [roster]);
  const shortages = useMemo(() => topShortages(roster), [roster]);

  const hasData = t.total.requiredHeadcount > 0 || t.total.currentFte > 0;

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
            description="Enter beds, occupancy and Current FTE in Physicians Planning, Nurses Planning or Current Workforce — this overview populates automatically."
          />
        </Section>
      ) : (
        <div className="space-y-6">
          {/* Workforce KPI groups */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TypeGroup icon={<Stethoscope className="h-5 w-5" />} title="Physicians" to="/physicians" accent="text-primary" data={t.physician} />
            <TypeGroup icon={<HeartPulse className="h-5 w-5" />} title="Nurses" to="/nurses" accent="text-teal" data={t.nurse} />
            <TotalGroup />
          </div>

          {/* Top workforce shortages */}
          <Section title="Top Workforce Shortages" description="Largest gaps ranked by absolute shortage, across physicians and nurses.">
            {shortages.length === 0 ? (
              <div className="rounded-xl bg-balanced/10 px-4 py-6 text-center text-sm font-semibold text-balanced">
                No shortages — every unit is balanced or in surplus.
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {shortages.map((r) => (
                  <li key={`${r.workforceType}-${r.id}`} className="flex items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          r.workforceType === 'Physician' ? 'bg-primary/10 text-primary' : 'bg-teal/10 text-teal'
                        }`}>
                          {r.workforceType}
                        </span>
                        <span className="truncate font-bold text-navy">{r.unit}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-navy/55">
                        Required {fmtInt(r.requiredHeadcount)} · Current {fmt(r.currentFte)}
                      </div>
                    </div>
                    <span className="ml-3 shrink-0 rounded-full bg-shortage/10 px-3 py-1 text-xs font-bold text-shortage">
                      Shortage {fmt(r.shortage)}
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

  function TotalGroup() {
    return (
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-softbg text-navy">
            <Users className="h-5 w-5" />
          </span>
          <h2 className="text-base font-bold text-navy">Total Workforce</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <Metric label="Required" value={fmtInt(t.total.requiredHeadcount)} tone="text-navy" />
          <Metric label="Current" value={fmt(t.total.currentFte)} tone="text-navy" />
          <Metric
            label="Net Gap"
            value={`${t.total.netGap > 0 ? '+' : ''}${fmt(t.total.netGap)}`}
            tone={t.total.netGap < 0 ? 'text-shortage' : t.total.netGap > 0 ? 'text-surplus' : 'text-balanced'}
          />
          <Metric label="Units w/ Shortage" value={fmtInt(t.total.unitsWithShortage)} tone="text-attention" />
        </div>
      </div>
    );
  }
}

function TypeGroup({
  icon,
  title,
  to,
  accent,
  data,
}: {
  icon: React.ReactNode;
  title: string;
  to: string;
  accent: string;
  data: TypeTotals;
}) {
  return (
    <div className="card p-5">
      <Link to={to} className="mb-4 flex items-center gap-2 transition hover:opacity-80">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-softbg ${accent}`}>{icon}</span>
        <h2 className="text-base font-bold text-navy">{title}</h2>
      </Link>
      <div className="grid grid-cols-2 gap-2 text-center">
        <Metric label="Required HC" value={fmtInt(data.requiredHeadcount)} tone={accent} />
        <Metric label="Current FTE" value={fmt(data.currentFte)} tone="text-navy" />
        <Metric label="Shortage" value={fmt(data.shortage)} tone="text-shortage" />
        <Metric label="Surplus" value={fmt(data.surplus)} tone="text-surplus" />
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
