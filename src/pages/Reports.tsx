import { useMemo, useState } from 'react';
import { PageHeader, Section, StatusBadge, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { filterRecords, latestPerDepartment, toSummary, totals } from '../lib/aggregate';
import { buildCommentary } from '../lib/calc';
import { fmtInt, monthName, MONTHS } from '../lib/format';

export function Reports() {
  const { hospital, records } = useApp();

  const [fHospital, setFHospital] = useState('');
  const [fDepartment, setFDepartment] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fYear, setFYear] = useState('');

  const departmentOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.department))).sort(),
    [records],
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.year))).sort((a, b) => b - a),
    [records],
  );

  const filtered = useMemo(
    () =>
      filterRecords(records, {
        hospital: fHospital || undefined,
        department: fDepartment || undefined,
        month: fMonth ? Number(fMonth) : undefined,
        year: fYear ? Number(fYear) : undefined,
      }),
    [records, fHospital, fDepartment, fMonth, fYear],
  );

  const rows = useMemo(() => toSummary(latestPerDepartment(filtered)), [filtered]);
  const t = useMemo(() => totals(rows), [rows]);

  const resetFilters = () => {
    setFHospital('');
    setFDepartment('');
    setFMonth('');
    setFYear('');
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Nursing Workforce Plan — latest saved calculation per department."
        actions={
          <button className="btn-ghost" onClick={() => window.print()}>
            Print / Export
          </button>
        }
      />

      <div className="space-y-6">
        <Section title="Filters">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <select className="input" value={fHospital} onChange={(e) => setFHospital(e.target.value)}>
              <option value="">All Hospitals</option>
              <option value={hospital}>{hospital}</option>
            </select>
            <select className="input" value={fDepartment} onChange={(e) => setFDepartment(e.target.value)}>
              <option value="">All Departments</option>
              {departmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select className="input" value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
              <option value="">All Months</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select className="input" value={fYear} onChange={(e) => setFYear(e.target.value)}>
              <option value="">All Years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button className="btn-ghost" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </Section>

        <Section
          title="Nursing Workforce Plan"
          description={`${rows.length} department${rows.length === 1 ? '' : 's'}${
            fMonth ? ` · ${monthName(Number(fMonth))}` : ''
          }${fYear ? ` ${fYear}` : ''}`}
        >
          {rows.length === 0 ? (
            <EmptyState
              title="No records match the current filters"
              description={records.length === 0 ? 'Save a plan in Workforce Planning to build the report.' : 'Try clearing the filters.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                    <th className="py-2.5 pr-3 font-semibold">Department</th>
                    <th className="py-2.5 px-3 font-semibold">Type</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Current HC</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Required HC</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Gap</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Shortage</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Surplus</th>
                    <th className="py-2.5 pl-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.department}>
                      <td className="py-3 pr-3 font-semibold text-navy">{r.department}</td>
                      <td className="py-3 px-3 text-navy/60">{r.departmentType}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.currentHc)}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.requiredHc)}</td>
                      <td className={`py-3 px-3 text-right font-semibold ${r.gap < 0 ? 'text-shortage' : r.gap > 0 ? 'text-surplus' : 'text-balanced'}`}>
                        {r.gap > 0 ? `+${fmtInt(r.gap)}` : fmtInt(r.gap)}
                      </td>
                      <td className="py-3 px-3 text-right text-shortage">{r.shortage ? fmtInt(r.shortage) : '—'}</td>
                      <td className="py-3 px-3 text-right text-surplus">{r.surplus ? fmtInt(r.surplus) : '—'}</td>
                      <td className="py-3 pl-3">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-softbg/40 font-bold text-navy">
                    <td className="py-3 pr-3">TOTAL</td>
                    <td className="py-3 px-3" />
                    <td className="py-3 px-3 text-right">{fmtInt(t.currentHc)}</td>
                    <td className="py-3 px-3 text-right">{fmtInt(t.requiredHc)}</td>
                    <td className={`py-3 px-3 text-right ${t.gap < 0 ? 'text-shortage' : t.gap > 0 ? 'text-surplus' : 'text-balanced'}`}>
                      {t.gap > 0 ? `+${fmtInt(t.gap)}` : fmtInt(t.gap)}
                    </td>
                    <td className="py-3 px-3 text-right text-shortage">{fmtInt(t.shortage)}</td>
                    <td className="py-3 px-3 text-right text-surplus">{fmtInt(t.surplus)}</td>
                    <td className="py-3 pl-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Section>

        {rows.length > 0 && (
          <Section title="Executive Commentary" description="Rule-based summary per department.">
            <ul className="space-y-2 text-sm text-navy/75">
              {rows.map((r) => (
                <li key={r.department} className="flex gap-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      r.status === 'SHORTAGE' ? 'bg-shortage' : r.status === 'SURPLUS' ? 'bg-surplus' : 'bg-balanced'
                    }`}
                  />
                  {buildCommentary(r.department, r.status, r.shortage, r.surplus)}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
