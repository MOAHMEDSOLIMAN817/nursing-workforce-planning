import { useMemo, useState } from 'react';
import { Search, Trash2, Pencil, Plus } from 'lucide-react';
import { PageHeader, Section, Field, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { modelForType } from '../services/nursingCalculator';
import { coversNurses, coversPhysicians } from '../lib/units';
import { uid } from '../lib/format';
import type { NurseUnitType, UnitConfig, WorkforceCoverage } from '../lib/types';

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

const COVERAGE: WorkforceCoverage[] = ['Nurses', 'Physicians', 'Both'];

type Draft = Pick<
  UnitConfig,
  'name' | 'workforceType' | 'unitType' | 'model' | 'coverageHours' | 'nurseRatio' | 'physicianRatio' | 'status'
>;

const emptyDraft = (): Draft => ({
  name: '',
  workforceType: 'Nurses',
  unitType: 'Inpatient Ward',
  model: 'Inpatient',
  coverageHours: 24,
  nurseRatio: 2,
  physicianRatio: 10,
  status: 'Active',
});

// A unit has "real" data worth protecting from accidental deletion.
const hasData = (u: UnitConfig): boolean =>
  u.beds > 0 || u.occupancyRate > 0 || u.clinics > 0 || u.nurseCurrentFte > 0 || u.physicianCurrentFte > 0;

export function Departments() {
  const { units, addUnit, updateUnit, removeUnit } = useApp();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [coverageFilter, setCoverageFilter] = useState<'ALL' | WorkforceCoverage>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Active' | 'Inactive'>('ALL');

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError('');
  };

  const resetForm = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setError('');
  };

  const startEdit = (u: UnitConfig) => {
    setDraft({
      name: u.name,
      workforceType: u.workforceType,
      unitType: u.unitType,
      model: u.model,
      coverageHours: u.coverageHours,
      nurseRatio: u.nurseRatio,
      physicianRatio: u.physicianRatio,
      status: u.status,
    });
    setEditingId(u.id);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = () => {
    if (!draft.name.trim()) return setError('Unit name is required.');
    if (coversNurses(draft as UnitConfig) && !(draft.nurseRatio > 0))
      return setError('Nurse ratio must be greater than 0.');
    if (coversPhysicians(draft as UnitConfig) && !(draft.physicianRatio > 0))
      return setError('Physician ratio must be greater than 0.');
    if (!(draft.coverageHours > 0)) return setError('Coverage hours must be greater than 0.');
    const dup = units.some(
      (u) => u.name.trim().toLowerCase() === draft.name.trim().toLowerCase() && u.id !== editingId,
    );
    if (dup) return setError('A unit with this name already exists.');

    if (editingId) {
      updateUnit(editingId, {
        name: draft.name.trim(),
        workforceType: draft.workforceType,
        unitType: draft.unitType,
        model: draft.model,
        coverageHours: draft.coverageHours,
        nurseRatio: draft.nurseRatio,
        physicianRatio: draft.physicianRatio,
        status: draft.status,
      });
    } else {
      addUnit({
        id: uid(),
        name: draft.name.trim(),
        unitType: draft.unitType,
        model: draft.model,
        status: draft.status,
        workforceType: draft.workforceType,
        beds: 0,
        occupancyRate: 0,
        clinics: 0,
        nursesPerClinic: 1,
        coverageHours: draft.coverageHours,
        workingDaysPerMonth: 26,
        physicianRatio: draft.physicianRatio,
        physicianCurrentFte: 0,
        nurseRatio: draft.nurseRatio,
        nurseCurrentFte: 0,
      });
    }
    resetForm();
  };

  const toggleStatus = (u: UnitConfig) =>
    updateUnit(u.id, { status: u.status === 'Active' ? 'Inactive' : 'Active' });

  const remove = (u: UnitConfig) => {
    const msg = hasData(u)
      ? `"${u.name}" has planning or workforce data. Deleting is permanent — consider deactivating instead to keep history. Delete anyway?`
      : `Delete "${u.name}"?`;
    if (!confirm(msg)) return;
    if (editingId === u.id) resetForm();
    removeUnit(u.id);
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return units.filter(
      (u) =>
        (coverageFilter === 'ALL' || u.workforceType === coverageFilter) &&
        (statusFilter === 'ALL' || u.status === statusFilter) &&
        (q === '' || u.name.toLowerCase().includes(q) || u.unitType.toLowerCase().includes(q)),
    );
  }, [units, query, coverageFilter, statusFilter]);

  const activeCount = units.filter((u) => u.status === 'Active').length;

  return (
    <div>
      <PageHeader
        title="Departments / Units"
        subtitle="Master configuration. Every unit here is the single source of truth — changes flow automatically to Physicians Planning, Nurses Planning, Current Workforce, Executive Overview and all filters."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Form */}
        <div className="xl:col-span-1">
          <Section title={editingId ? 'Edit Unit' : 'Add Unit'}>
            <div className="space-y-4">
              <Field label="Unit Name">
                <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. VIP" />
              </Field>

              <Field label="Workforce Coverage" hint="Which planning modules this unit appears in">
                <select
                  className="input"
                  value={draft.workforceType}
                  onChange={(e) => set({ workforceType: e.target.value as WorkforceCoverage })}
                >
                  {COVERAGE.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Unit Type">
                <select
                  className="input"
                  value={draft.unitType}
                  onChange={(e) => {
                    const unitType = e.target.value as NurseUnitType;
                    set({ unitType, model: modelForType(unitType) });
                  }}
                >
                  {UNIT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="rounded-lg bg-softbg/60 px-3 py-2 text-xs text-navy/55">
                Calculation model: <b className="text-navy">{draft.model}</b>
                {draft.model === 'Clinic' ? ' (session hours)' : ' (bed occupancy)'}
              </div>

              {(draft.workforceType === 'Nurses' || draft.workforceType === 'Both') && (
                <Field label="Nurse Ratio (1 : N)" hint="Patients per nurse">
                  <input className="input" type="number" min={1} value={draft.nurseRatio} onChange={(e) => set({ nurseRatio: Number(e.target.value) })} />
                </Field>
              )}
              {(draft.workforceType === 'Physicians' || draft.workforceType === 'Both') && (
                <Field label="Physician Ratio (1 : N)" hint="Patients per physician">
                  <input className="input" type="number" min={1} value={draft.physicianRatio} onChange={(e) => set({ physicianRatio: Number(e.target.value) })} />
                </Field>
              )}

              <Field label="Coverage Hours / Day" hint={draft.model === 'Clinic' ? 'Operating hours per day' : 'Hours the unit is covered'}>
                <input className="input" type="number" min={1} value={draft.coverageHours} onChange={(e) => set({ coverageHours: Number(e.target.value) })} />
              </Field>

              <Field label="Status">
                <select className="input" value={draft.status} onChange={(e) => set({ status: e.target.value as 'Active' | 'Inactive' })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </Field>

              {error && <p className="text-xs font-medium text-shortage">{error}</p>}

              <div className="flex gap-2">
                <button className="btn-primary" onClick={save}>
                  {editingId ? 'Update Unit' : <><Plus className="h-4 w-4" /> Add Unit</>}
                </button>
                {editingId && (
                  <button className="btn-ghost" onClick={resetForm}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </Section>
        </div>

        {/* Master list */}
        <div className="xl:col-span-2">
          <Section title="Configured Units" description={`${units.length} total · ${activeCount} active`}>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/40" />
                <input className="input !w-52 !py-2 !pl-9" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm font-medium text-navy" value={coverageFilter} onChange={(e) => setCoverageFilter(e.target.value as 'ALL' | WorkforceCoverage)}>
                <option value="ALL">All coverage</option>
                {COVERAGE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm font-medium text-navy" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'Active' | 'Inactive')}>
                <option value="ALL">All status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <span className="text-xs text-navy/45">{rows.length} shown</span>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="No units match" description="Adjust filters or add a unit." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                      <th className="py-2.5 pr-3 font-semibold">Name</th>
                      <th className="py-2.5 px-3 font-semibold">Coverage</th>
                      <th className="py-2.5 px-3 font-semibold">Type</th>
                      <th className="py-2.5 px-3 font-semibold">Ratio</th>
                      <th className="py-2.5 px-3 font-semibold">Coverage&nbsp;Hrs</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                      <th className="py-2.5 pl-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((u) => (
                      <tr key={u.id} className={u.status === 'Inactive' ? 'opacity-55' : ''}>
                        <td className="py-2.5 pr-3 font-semibold text-navy">{u.name}</td>
                        <td className="py-2.5 px-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            u.workforceType === 'Physicians' ? 'bg-primary/10 text-primary'
                              : u.workforceType === 'Nurses' ? 'bg-teal/10 text-teal'
                                : 'bg-attention/10 text-attention'
                          }`}>
                            {u.workforceType}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-navy/70">{u.unitType}</td>
                        <td className="py-2.5 px-3 text-navy/70">
                          {coversNurses(u) && <span title="Nurse ratio">N 1:{u.nurseRatio}</span>}
                          {coversNurses(u) && coversPhysicians(u) && ' · '}
                          {coversPhysicians(u) && <span title="Physician ratio">P 1:{u.physicianRatio}</span>}
                        </td>
                        <td className="py-2.5 px-3 text-navy/70">{u.coverageHours}h</td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={() => toggleStatus(u)}
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${u.status === 'Active' ? 'bg-balanced/10 text-balanced' : 'bg-navy/10 text-navy/50'}`}
                            title="Toggle active/inactive"
                          >
                            {u.status}
                          </button>
                        </td>
                        <td className="py-2.5 pl-3">
                          <div className="flex justify-end gap-1">
                            <button className="rounded-lg p-1.5 text-primary hover:bg-softbg" onClick={() => startEdit(u)} title="Edit" aria-label={`Edit ${u.name}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button className="rounded-lg p-1.5 text-navy/40 hover:bg-shortage/10 hover:text-shortage" onClick={() => remove(u)} title="Delete" aria-label={`Delete ${u.name}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
