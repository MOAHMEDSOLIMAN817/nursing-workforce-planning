import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Search, Link2, ArrowRight } from 'lucide-react';
import { PageHeader, Section, KpiCard, EmptyState, Field } from '../components/ui';
import { useApp } from '../store/AppContext';
import { buildRoster, rosterTotals, type RosterAssumptions, type WorkforceRow } from '../services/workforceRoster';
import { validateMapping } from '../services/unitMapping';
import { fmt, fmtInt, uid } from '../lib/format';
import type { NurseUnit, PhysicianUnit, UnitMapping, WorkforceType } from '../lib/types';

const STATUS_CLS: Record<string, string> = {
  SHORTAGE: 'bg-shortage/10 text-shortage',
  BALANCED: 'bg-balanced/10 text-balanced',
  SURPLUS: 'bg-surplus/10 text-surplus',
};

type TypeFilter = 'ALL' | WorkforceType;
type StatusFilter = 'ALL' | 'SHORTAGE' | 'BALANCED' | 'SURPLUS';

export function CurrentWorkforce() {
  const { physicianUnits, setPhysicianUnits, nurseUnits, setNurseUnits, unitMappings, setUnitMappings, settings } = useApp();

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
  const totals = useMemo(() => rosterTotals(roster), [roster]);

  // Filters
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [query, setQuery] = useState('');

  const departments = useMemo(() => Array.from(new Set(roster.map((r) => r.department))), [roster]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter(
      (r) =>
        (typeFilter === 'ALL' || r.workforceType === typeFilter) &&
        (deptFilter === 'ALL' || r.department === deptFilter) &&
        (statusFilter === 'ALL' || r.status === statusFilter) &&
        (q === '' || r.unit.toLowerCase().includes(q) || r.section.toLowerCase().includes(q)),
    );
  }, [roster, typeFilter, deptFilter, statusFilter, query]);

  // Editing Current FTE writes back to the single source of truth (the unit).
  const setCurrentFte = (row: WorkforceRow, value: number) => {
    if (row.workforceType === 'Physician') {
      setPhysicianUnits(physicianUnits.map((u: PhysicianUnit) => (u.id === row.id ? { ...u, currentFte: value } : u)));
    } else {
      setNurseUnits(nurseUnits.map((u: NurseUnit) => (u.id === row.id ? { ...u, currentFte: value } : u)));
    }
  };

  return (
    <div>
      <PageHeader
        title="Current Workforce"
        subtitle="Actual staffing on hand today, joined to the validated required headcount. Current FTE here is the single source of truth used across every page."
      />

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Required" value={fmtInt(totals.total.requiredHeadcount)} tone="purple" />
        <KpiCard label="Total Current FTE" value={fmt(totals.total.currentFte)} tone="teal" />
        <KpiCard
          label="Net Gap"
          value={`${totals.total.netGap > 0 ? '+' : ''}${fmt(totals.total.netGap)}`}
          tone={totals.total.netGap < 0 ? 'shortage' : totals.total.netGap > 0 ? 'surplus' : 'balanced'}
        />
        <KpiCard label="Units with Shortage" value={fmtInt(totals.total.unitsWithShortage)} tone="attention" />
      </div>

      {/* Gap summary table */}
      <Section
        title="Gap Analysis"
        description="Demand → Required Headcount → Current FTE → Gap → Status. Edit Current FTE inline; it updates Physicians / Nurses Planning and the Executive Overview instantly."
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/40" />
            <input
              className="input !w-56 !py-2 !pl-9"
              placeholder="Search unit or section…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <FilterSelect label="Type" value={typeFilter} onChange={(v) => setTypeFilter(v as TypeFilter)} options={['ALL', 'Physician', 'Nurse']} />
          <FilterSelect label="Department" value={deptFilter} onChange={setDeptFilter} options={['ALL', ...departments]} />
          <FilterSelect label="Status" value={statusFilter} onChange={(v) => setStatusFilter(v as StatusFilter)} options={['ALL', 'SHORTAGE', 'BALANCED', 'SURPLUS']} />
          <span className="text-xs text-navy/45">{rows.length} of {roster.length} units</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                <th className="py-2.5 pr-3 font-semibold">Type</th>
                <th className="py-2.5 px-3 font-semibold">Department</th>
                <th className="py-2.5 px-3 font-semibold">Unit</th>
                <th className="py-2.5 px-3 font-semibold">Specialty / Section</th>
                <th className="py-2.5 px-3 text-right font-semibold">Required HC</th>
                <th className="py-2.5 px-3 text-right font-semibold text-primary">Current FTE</th>
                <th className="py-2.5 px-3 text-right font-semibold">Gap</th>
                <th className="py-2.5 pl-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={`${r.workforceType}-${r.id}`} className="hover:bg-softbg/30">
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      r.workforceType === 'Physician' ? 'bg-primary/10 text-primary' : 'bg-teal/10 text-teal'
                    }`}>
                      {r.workforceType}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-navy/60">{r.department}</td>
                  <td className="py-2 px-3 font-semibold text-navy">{r.unit}</td>
                  <td className="py-2 px-3 text-navy/60">{r.section}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-navy/80">{fmtInt(r.requiredHeadcount)}</td>
                  <td className="py-1.5 px-3 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={Number.isFinite(r.currentFte) && r.currentFte !== 0 ? r.currentFte : ''}
                      onChange={(e) => setCurrentFte(r, e.target.value === '' ? 0 : Number(e.target.value))}
                      placeholder="0"
                      aria-label={`Current FTE for ${r.unit}`}
                      className="w-20 rounded-lg border border-primary/20 bg-primary/[0.04] px-2 py-1.5 text-right text-sm tabular-nums text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-bold tabular-nums">
                    <span className={r.gap < 0 ? 'text-shortage' : r.gap > 0 ? 'text-surplus' : 'text-balanced'}>
                      {r.gap > 0 ? `+${fmt(r.gap)}` : fmt(r.gap)}
                    </span>
                  </td>
                  <td className="py-2 pl-3">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_CLS[r.status]}`}>
                      {r.status === 'BALANCED'
                        ? 'Balanced'
                        : r.status === 'SHORTAGE'
                          ? `Shortage ${fmt(r.shortage)}`
                          : `Surplus ${fmt(r.surplus)}`}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-navy/50">No units match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Unit mapping layer */}
      <div className="mt-6">
        <UnitMappingCard
          mappings={unitMappings}
          setMappings={setUnitMappings}
          physicianUnits={physicianUnits}
          nurseUnits={nurseUnits}
        />
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-navy/55">
      {label}
      <select
        className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm font-medium text-navy outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 'ALL' ? 'All' : o.charAt(0) + o.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------------------------- unit mapping card --------------------------- */

function UnitMappingCard({
  mappings,
  setMappings,
  physicianUnits,
  nurseUnits,
}: {
  mappings: UnitMapping[];
  setMappings: (m: UnitMapping[]) => void;
  physicianUnits: PhysicianUnit[];
  nurseUnits: NurseUnit[];
}) {
  const [sourceName, setSourceName] = useState('');
  const [workforceType, setWorkforceType] = useState<WorkforceType>('Nurse');
  const [planningUnitId, setPlanningUnitId] = useState('');
  const [error, setError] = useState('');

  const unitName = (type: WorkforceType, id: string): string => {
    const list = type === 'Physician' ? physicianUnits : nurseUnits;
    return list.find((u) => u.id === id)?.unit ?? '(deleted unit)';
  };

  const planningOptions = workforceType === 'Physician' ? physicianUnits : nurseUnits;

  const add = () => {
    const err = validateMapping({ sourceName, workforceType, planningUnitId }, mappings);
    if (err) return setError(err);
    setMappings([...mappings, { id: uid(), sourceName: sourceName.trim(), workforceType, planningUnitId }]);
    setSourceName('');
    setPlanningUnitId('');
    setError('');
  };

  const remove = (id: string) => setMappings(mappings.filter((m) => m.id !== id));

  return (
    <Section
      title="Unit Mapping"
      description="Map an external/actual source unit name to a single planning unit (explicit, non-fuzzy). Each source name maps once, so no FTE is counted twice. Used when importing actual workforce data."
      right={
        <Link to="/nurses" className="hidden items-center gap-1 text-xs font-semibold text-primary hover:underline sm:inline-flex">
          Planning units <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {/* Add form */}
      <div className="grid grid-cols-1 gap-3 rounded-xl bg-softbg/50 p-4 sm:grid-cols-[1fr_auto_1fr_auto]">
        <Field label="Source Unit Name">
          <input
            className="input"
            placeholder="e.g. Riyadh PICU - NU"
            value={sourceName}
            onChange={(e) => {
              setSourceName(e.target.value);
              setError('');
            }}
          />
        </Field>
        <Field label="Workforce Type">
          <select
            className="input !w-auto"
            value={workforceType}
            onChange={(e) => {
              setWorkforceType(e.target.value as WorkforceType);
              setPlanningUnitId('');
            }}
          >
            <option value="Physician">Physician</option>
            <option value="Nurse">Nurse</option>
          </select>
        </Field>
        <Field label="Mapped Planning Unit">
          <select className="input" value={planningUnitId} onChange={(e) => setPlanningUnitId(e.target.value)}>
            <option value="">Select unit…</option>
            {planningOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unit}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button className="btn-primary w-full sm:w-auto" onClick={add}>
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-shortage">{error}</p>}

      {/* Existing mappings */}
      <div className="mt-4">
        {mappings.length === 0 ? (
          <EmptyState
            title="No mappings yet"
            description="Add a mapping when your actual workforce data uses a different unit name from planning."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                  <th className="py-2.5 pr-3 font-semibold">Source Name</th>
                  <th className="py-2.5 px-3 font-semibold">Workforce Type</th>
                  <th className="py-2.5 px-3 font-semibold">Mapped Planning Unit</th>
                  <th className="py-2.5 pl-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 pr-3 font-semibold text-navy">{m.sourceName}</td>
                    <td className="py-2.5 px-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        m.workforceType === 'Physician' ? 'bg-primary/10 text-primary' : 'bg-teal/10 text-teal'
                      }`}>
                        {m.workforceType}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-navy/70">
                      <span className="inline-flex items-center gap-1.5">
                        <Link2 className="h-3.5 w-3.5 text-navy/40" />
                        {unitName(m.workforceType, m.planningUnitId)}
                      </span>
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        className="rounded-lg p-1.5 text-navy/40 hover:bg-shortage/10 hover:text-shortage"
                        onClick={() => remove(m.id)}
                        aria-label={`Remove mapping ${m.sourceName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}
