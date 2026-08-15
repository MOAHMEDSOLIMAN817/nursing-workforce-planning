import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Section, KpiCard, StatusBadge, EmptyState } from '../components/ui';
import { BarChart } from '../components/BarChart';
import { useApp } from '../store/AppContext';
import { latestPerDepartment, toSummary, totals } from '../lib/aggregate';
import { fmtInt } from '../lib/format';

export function Dashboard() {
  const { records } = useApp();

  const rows = useMemo(() => toSummary(latestPerDepartment(records)), [records]);
  const t = useMemo(() => totals(rows), [rows]);
  const shortageRows = rows.filter((r) => r.status === 'SHORTAGE');
  const chartData = rows.map((r) => ({ label: r.department, current: r.currentHc, required: r.requiredHc }));

  return (
    <div>
      <PageHeader
        title="Executive Dashboard"
        subtitle="Consolidated nursing capacity across departments (latest saved plan per department)."
        actions={
          <Link to="/planning" className="btn-primary">
            New Calculation
          </Link>
        }
      />

      {records.length === 0 ? (
        <Section title="Get started">
          <EmptyState
            title="No saved plans yet"
            description="Head to Workforce Planning, run a calculation, and save it to populate the dashboard."
          />
        </Section>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total Current Nursing HC" value={fmtInt(t.currentHc)} tone="teal" />
            <KpiCard label="Total Required Nursing HC" value={fmtInt(t.requiredHc)} tone="purple" />
            <KpiCard label="Total Shortage" value={fmtInt(t.shortage)} tone="shortage" hint="Sum of departmental shortages" />
            <KpiCard label="Total Surplus" value={fmtInt(t.surplus)} tone="surplus" hint="Sum of departmental surpluses" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Section title="Current HC vs Required HC by Department">
                {chartData.length ? <BarChart data={chartData} /> : <EmptyState title="No data" />}
              </Section>
            </div>

            <div className="lg:col-span-2">
              <Section title="Departments Requiring Action" description="Departments currently in shortage.">
                {shortageRows.length === 0 ? (
                  <div className="rounded-xl bg-balanced/10 px-4 py-6 text-center text-sm font-semibold text-balanced">
                    All departments are balanced or in surplus.
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {shortageRows.map((r) => (
                      <li key={r.department} className="rounded-xl border border-border bg-white p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-navy">{r.department}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="mt-2 flex items-center gap-5 text-sm text-navy/60">
                          <span>Current: <b className="text-navy">{fmtInt(r.currentHc)}</b></span>
                          <span>Required: <b className="text-navy">{fmtInt(r.requiredHc)}</b></span>
                          <span className="text-shortage">Shortage: <b>{fmtInt(r.shortage)}</b></span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
