import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Section, Field, EmptyState, KpiCard } from '../components/ui';
import { useApp } from '../store/AppContext';
import { calcInpatient } from '../lib/calc';
import { fmt, fmtInt } from '../lib/format';

const PRESET_OCCUPANCIES = [60, 70, 80, 90, 100];

export function ScenarioPlanning() {
  const { settings, departments } = useApp();
  const inpatientDepts = useMemo(() => departments.filter((d) => d.type === 'Inpatient' && d.active), [departments]);

  const [deptName, setDeptName] = useState(inpatientDepts[0]?.name ?? '');
  const [beds, setBeds] = useState('20');
  const [nurseRatio, setNurseRatio] = useState(String(inpatientDepts[0]?.defaultNurseRatio || 2));
  const [coverageHours, setCoverageHours] = useState(String(inpatientDepts[0]?.defaultCoverageHours || 24));
  const [workingDays, setWorkingDays] = useState(String(settings.standardWorkingDays));
  const [monthlyNurseHours, setMonthlyNurseHours] = useState(String(settings.standardMonthlyNurseHours));
  const [customOcc, setCustomOcc] = useState('85');

  const onSelectDept = (name: string) => {
    setDeptName(name);
    const d = departments.find((x) => x.name === name);
    if (d) {
      setNurseRatio(String(d.defaultNurseRatio || 2));
      setCoverageHours(String(d.defaultCoverageHours || 24));
    }
  };

  const params = {
    beds: Number(beds),
    nurseRatio: Number(nurseRatio),
    coverageHours: Number(coverageHours),
    workingDays: Number(workingDays),
    monthlyNurseHours: Number(monthlyNurseHours),
  };

  const valid =
    params.beds >= 0 &&
    params.nurseRatio > 0 &&
    params.coverageHours >= 0 &&
    params.workingDays >= 0 &&
    params.monthlyNurseHours > 0;

  const compute = (occ: number) => {
    if (!valid || occ < 0 || occ > 100) return null;
    const { breakdown } = calcInpatient(
      {
        beds: params.beds,
        occupancyRate: occ,
        nurseRatio: params.nurseRatio,
        coverageHours: params.coverageHours,
        workingDays: params.workingDays,
      },
      0,
      params.monthlyNurseHours,
    );
    return breakdown;
  };

  const custom = Number(customOcc);
  const customValid = valid && !Number.isNaN(custom) && custom >= 0 && custom <= 100;

  return (
    <div>
      <PageHeader
        title="Scenario Planning"
        subtitle="Model Required HC for an Inpatient department across occupancy levels."
      />

      {inpatientDepts.length === 0 ? (
        <Section title="Scenario Planning">
          <EmptyState
            title="No active inpatient departments"
            description="Add an inpatient department on the Departments page first."
          />
        </Section>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <Section title="Department Parameters" description="Occupancy is varied; everything else stays fixed.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Department">
                    <select className="input" value={deptName} onChange={(e) => onSelectDept(e.target.value)}>
                      {inpatientDepts.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Number of Beds">
                  <input className="input" type="number" min={0} value={beds} onChange={(e) => setBeds(e.target.value)} />
                </Field>
                <Field label="Nurse : Patient Ratio (1 : N)">
                  <input className="input" type="number" min={1} value={nurseRatio} onChange={(e) => setNurseRatio(e.target.value)} />
                </Field>
                <Field label="Coverage Hours / Day">
                  <input className="input" type="number" min={0} value={coverageHours} onChange={(e) => setCoverageHours(e.target.value)} />
                </Field>
                <Field label="Working Days / Month">
                  <input className="input" type="number" min={0} value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} />
                </Field>
                <Field label="Working Hours / Nurse / Month">
                  <input className="input" type="number" min={1} value={monthlyNurseHours} onChange={(e) => setMonthlyNurseHours(e.target.value)} />
                </Field>
                <Field label="Custom Occupancy %">
                  <input className="input" type="number" min={0} max={100} value={customOcc} onChange={(e) => setCustomOcc(e.target.value)} />
                </Field>
              </div>
              {!valid && (
                <p className="mt-3 text-xs font-medium text-shortage">
                  Enter valid parameters (nurse ratio and monthly hours must be greater than 0).
                </p>
              )}
            </Section>
          </div>

          <div className="xl:col-span-3 space-y-6">
            <Section title="Required HC by Occupancy" description={deptName}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                      <th className="py-2.5 font-semibold">Occupancy</th>
                      <th className="py-2.5 font-semibold">Occupied Beds</th>
                      <th className="py-2.5 font-semibold">Concurrent Nurses</th>
                      <th className="py-2.5 font-semibold">Required Hours</th>
                      <th className="py-2.5 text-right font-semibold">Required HC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {PRESET_OCCUPANCIES.map((occ) => {
                      const b = compute(occ);
                      return (
                        <tr key={occ}>
                          <td className="py-3 font-semibold text-navy">{occ}%</td>
                          <td className="py-3 text-navy/70">{b ? fmt(b.occupiedBeds) : '—'}</td>
                          <td className="py-3 text-navy/70">{b ? fmt(b.concurrentNurses) : '—'}</td>
                          <td className="py-3 text-navy/70">{b ? fmtInt(b.requiredHours) : '—'}</td>
                          <td className="py-3 text-right text-lg font-extrabold text-primary">{b ? fmtInt(b.requiredHc) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Custom Occupancy Scenario">
              {customValid ? (
                (() => {
                  const b = compute(custom)!;
                  return (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <KpiCard label={`Occupancy ${custom}%`} value={`${fmt(b.occupiedBeds)}`} tone="navy" hint="Occupied beds" />
                      <KpiCard label="Concurrent Nurses" value={fmt(b.concurrentNurses)} tone="teal" />
                      <KpiCard label="Required Hours" value={fmtInt(b.requiredHours)} tone="navy" />
                      <KpiCard label="Required HC" value={fmtInt(b.requiredHc)} tone="purple" />
                    </div>
                  );
                })()
              ) : (
                <EmptyState title="Enter a valid custom occupancy (0–100%)" />
              )}
            </Section>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-navy/45">
        Need to compare against current staffing? Run and save a plan in{' '}
        <Link to="/planning" className="font-semibold text-primary">
          Workforce Planning
        </Link>
        .
      </p>
    </div>
  );
}
