import { useState } from 'react';
import { PageHeader, Section, Field, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { uid } from '../lib/format';
import type { Department, DepartmentType, OpdClass } from '../lib/types';

const emptyDraft = (): Department => ({
  id: '',
  name: '',
  type: 'Inpatient',
  defaultNurseRatio: 2,
  defaultCoverageHours: 24,
  active: true,
  opdClass: 'Mixed',
});

export function Departments() {
  const { departments, setDepartments } = useApp();
  const [draft, setDraft] = useState<Department>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const resetForm = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setError('');
  };

  const startEdit = (d: Department) => {
    setDraft({ ...d });
    setEditingId(d.id);
    setError('');
  };

  const save = () => {
    if (!draft.name.trim()) {
      setError('Department name is required.');
      return;
    }
    if (draft.type === 'Inpatient' && !(draft.defaultNurseRatio > 0)) {
      setError('Default nurse ratio must be greater than 0 for inpatient departments.');
      return;
    }
    const duplicate = departments.some(
      (d) => d.name.trim().toLowerCase() === draft.name.trim().toLowerCase() && d.id !== editingId,
    );
    if (duplicate) {
      setError('A department with this name already exists.');
      return;
    }

    if (editingId) {
      setDepartments(departments.map((d) => (d.id === editingId ? { ...draft, id: editingId } : d)));
    } else {
      setDepartments([...departments, { ...draft, id: uid() }]);
    }
    resetForm();
  };

  const remove = (id: string) => {
    setDepartments(departments.filter((d) => d.id !== id));
    if (editingId === id) resetForm();
  };

  const toggleActive = (id: string) => {
    setDepartments(departments.map((d) => (d.id === id ? { ...d, active: !d.active } : d)));
  };

  return (
    <div>
      <PageHeader title="Departments" subtitle="Configure the departments available for planning." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <Section title={editingId ? 'Edit Department' : 'Add Department'}>
            <div className="space-y-4">
              <Field label="Department Name" error={error && !draft.name.trim() ? error : undefined}>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. ICU" />
              </Field>

              <Field label="Department Type">
                <select
                  className="input"
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as DepartmentType })}
                >
                  <option value="Inpatient">Inpatient</option>
                  <option value="OPD">OPD</option>
                </select>
              </Field>

              {draft.type === 'OPD' && (
                <Field label="OPD Classification">
                  <select
                    className="input"
                    value={draft.opdClass ?? 'Mixed'}
                    onChange={(e) => setDraft({ ...draft, opdClass: e.target.value as OpdClass })}
                  >
                    <option value="Surgery">Surgery</option>
                    <option value="Non-Surgery">Non-Surgery</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                </Field>
              )}

              {draft.type === 'Inpatient' && (
                <Field label="Default Nurse Ratio (1 : N)" hint="Patients per nurse">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={draft.defaultNurseRatio}
                    onChange={(e) => setDraft({ ...draft, defaultNurseRatio: Number(e.target.value) })}
                  />
                </Field>
              )}

              <Field label="Default Coverage Hours">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={draft.defaultCoverageHours}
                  onChange={(e) => setDraft({ ...draft, defaultCoverageHours: Number(e.target.value) })}
                />
              </Field>

              <label className="flex items-center gap-2.5 text-sm font-medium text-navy">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Active
              </label>

              {error && <p className="text-xs font-medium text-shortage">{error}</p>}

              <div className="flex gap-2">
                <button className="btn-primary" onClick={save}>
                  {editingId ? 'Update' : 'Add Department'}
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

        <div className="xl:col-span-2">
          <Section title="Configured Departments" description={`${departments.length} total`}>
            {departments.length === 0 ? (
              <EmptyState title="No departments" description="Add your first department using the form." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                      <th className="py-2.5 font-semibold">Name</th>
                      <th className="py-2.5 font-semibold">Type</th>
                      <th className="py-2.5 font-semibold">Ratio</th>
                      <th className="py-2.5 font-semibold">Coverage</th>
                      <th className="py-2.5 font-semibold">Status</th>
                      <th className="py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {departments.map((d) => (
                      <tr key={d.id}>
                        <td className="py-3 font-semibold text-navy">{d.name}</td>
                        <td className="py-3 text-navy/70">
                          {d.type}
                          {d.type === 'OPD' && d.opdClass ? ` · ${d.opdClass}` : ''}
                        </td>
                        <td className="py-3 text-navy/70">{d.type === 'Inpatient' ? `1 : ${d.defaultNurseRatio}` : '—'}</td>
                        <td className="py-3 text-navy/70">{d.defaultCoverageHours}h</td>
                        <td className="py-3">
                          <button
                            onClick={() => toggleActive(d.id)}
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                              d.active ? 'bg-balanced/10 text-balanced' : 'bg-navy/10 text-navy/50'
                            }`}
                          >
                            {d.active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="py-3">
                          <div className="flex justify-end gap-2">
                            <button className="text-xs font-semibold text-primary hover:underline" onClick={() => startEdit(d)}>
                              Edit
                            </button>
                            <button className="text-xs font-semibold text-shortage hover:underline" onClick={() => remove(d.id)}>
                              Delete
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
