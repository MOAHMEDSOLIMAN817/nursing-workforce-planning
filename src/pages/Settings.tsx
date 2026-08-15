import { useState } from 'react';
import { PageHeader, Section, Field, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { DEFAULT_SETTINGS } from '../store/storage';
import { fmtInt, monthName } from '../lib/format';
import type { Settings as SettingsType } from '../lib/types';

export function Settings() {
  const { settings, updateSettings, records, deleteRecord } = useApp();
  const [draft, setDraft] = useState<SettingsType>(settings);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');

  const set = (patch: Partial<SettingsType>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSavedMsg('');
  };

  const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

  const save = () => {
    // Global assumptions
    if (!(draft.workingDaysPerMonth > 0)) return setError('Working Days per Month must be greater than 0.');
    if (!(draft.coverageHoursPerDay > 0)) return setError('Coverage Hours per Day must be greater than 0.');
    if (!(draft.shiftLength > 0)) return setError('Shift Length must be greater than 0.');
    if (!(draft.availableHoursPerFteMonth > 0)) return setError('Available Hours per FTE / Month must be greater than 0.');
    if (!(draft.reliefFactorPct >= 0)) return setError('Relief Factor cannot be negative.');
    if (!(draft.minStaffPerShift >= 0)) return setError('Minimum Staff per Shift cannot be negative.');
    // Nursing engine
    if (!(draft.standardMonthlyNurseHours > 0)) return setError('Standard Monthly Nurse Hours must be greater than 0.');
    if (!(draft.standardWorkingDays > 0)) return setError('Standard Working Days must be greater than 0.');
    if (!(draft.surgeryOpdRatio > 0)) return setError('Surgery ratio must be greater than 0.');
    if (!(draft.nonSurgeryClinicsPerNurse > 0)) return setError('Non-surgery clinics per nurse must be greater than 0.');
    setError('');
    updateSettings(draft);
    setSavedMsg('Assumptions saved. Every workforce calculation now uses these values.');
  };

  const restore = () => {
    setDraft(DEFAULT_SETTINGS);
    updateSettings(DEFAULT_SETTINGS);
    setSavedMsg('Defaults restored.');
    setError('');
  };

  return (
    <div>
      <PageHeader
        title="Settings / Assumptions"
        subtitle="Central, editable assumptions shared by every workforce module. Stored locally and applied on save."
      />

      <div className="space-y-6">
        <Section
          title="Global Workforce Assumptions"
          description="Consumed by the physician engine (and reserved for overtime, cost and scenario planning). Never hardcoded in formulas."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Working Days per Month" hint="Days a unit operates each month">
              <input className="input" type="number" min={1} value={draft.workingDaysPerMonth}
                onChange={(e) => set({ workingDaysPerMonth: num(e.target.value) })} />
            </Field>
            <Field label="Coverage Hours per Day" hint="Hours the unit must be staffed daily">
              <input className="input" type="number" min={1} max={24} value={draft.coverageHoursPerDay}
                onChange={(e) => set({ coverageHoursPerDay: num(e.target.value) })} />
            </Field>
            <Field label="Shift Length (hours)" hint="Length of one clinical shift">
              <input className="input" type="number" min={1} value={draft.shiftLength}
                onChange={(e) => set({ shiftLength: num(e.target.value) })} />
            </Field>
            <Field label="Available Hours per FTE / Month" hint="Productive hours one FTE delivers monthly">
              <input className="input" type="number" min={1} value={draft.availableHoursPerFteMonth}
                onChange={(e) => set({ availableHoursPerFteMonth: num(e.target.value) })} />
            </Field>
            <Field label="Relief Factor %" hint="Leave/relief uplift — reserved for later phases">
              <input className="input" type="number" min={0} value={draft.reliefFactorPct}
                onChange={(e) => set({ reliefFactorPct: num(e.target.value) })} />
            </Field>
            <Field label="Minimum Staff per Shift" hint="Floor per covered shift">
              <input className="input" type="number" min={0} value={draft.minStaffPerShift}
                onChange={(e) => set({ minStaffPerShift: num(e.target.value) })} />
            </Field>
          </div>
        </Section>

        <Section
          title="Nursing Engine Ratios"
          description="Used by the existing Nurses Planning calculator."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Standard Monthly Nurse Hours">
              <input className="input" type="number" min={1} value={draft.standardMonthlyNurseHours}
                onChange={(e) => set({ standardMonthlyNurseHours: num(e.target.value) })} />
            </Field>
            <Field label="Standard Working Days">
              <input className="input" type="number" min={1} value={draft.standardWorkingDays}
                onChange={(e) => set({ standardWorkingDays: num(e.target.value) })} />
            </Field>
            <Field label="Surgery OPD Ratio" hint="Nurses per surgery clinic (1 : 1 → 1)">
              <input className="input" type="number" min={0.1} step={0.1} value={draft.surgeryOpdRatio}
                onChange={(e) => set({ surgeryOpdRatio: num(e.target.value) })} />
            </Field>
            <Field label="Non-Surgery OPD Ratio" hint="Clinics per nurse (1 : 5 → 5)">
              <input className="input" type="number" min={1} value={draft.nonSurgeryClinicsPerNurse}
                onChange={(e) => set({ nonSurgeryClinicsPerNurse: num(e.target.value) })} />
            </Field>
          </div>

          {error && <p className="mt-4 text-xs font-medium text-shortage">{error}</p>}
          {savedMsg && <p className="mt-4 text-xs font-medium text-balanced">{savedMsg}</p>}

          <div className="mt-5 flex gap-2">
            <button className="btn-primary" onClick={save}>Save Assumptions</button>
            <button className="btn-ghost" onClick={restore}>Restore Defaults</button>
          </div>
        </Section>

        <Section title="Active Values" description="What the calculation engines are using right now.">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <SettingRow k="Working Days / Month" v={String(settings.workingDaysPerMonth)} />
            <SettingRow k="Coverage Hours / Day" v={String(settings.coverageHoursPerDay)} />
            <SettingRow k="Shift Length" v={`${settings.shiftLength} h`} />
            <SettingRow k="Available Hours / FTE / Month" v={String(settings.availableHoursPerFteMonth)} />
            <SettingRow k="Relief Factor" v={`${settings.reliefFactorPct}%`} />
            <SettingRow k="Minimum Staff / Shift" v={String(settings.minStaffPerShift)} />
          </dl>
        </Section>

        <Section title="Saved Nurse Planning History" description={`${records.length} saved record${records.length === 1 ? '' : 's'} (persisted locally).`}>
          {records.length === 0 ? (
            <EmptyState title="No saved records" description="Save a calculation from Nurses Planning." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-navy/50">
                    <th className="py-2.5 pr-3 font-semibold">Department</th>
                    <th className="py-2.5 px-3 font-semibold">Period</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Current</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Required</th>
                    <th className="py-2.5 px-3 text-right font-semibold">Req. Hours</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Saved</th>
                    <th className="py-2.5 pl-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 pr-3 font-semibold text-navy">{r.department}</td>
                      <td className="py-3 px-3 text-navy/60">{monthName(r.month)} {r.year}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.currentHc)}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.requiredHc)}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.requiredHours)}</td>
                      <td className="py-3 px-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          r.status === 'SHORTAGE' ? 'bg-shortage/10 text-shortage'
                            : r.status === 'SURPLUS' ? 'bg-surplus/10 text-surplus'
                              : 'bg-balanced/10 text-balanced'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-navy/50">{new Date(r.calculationDate).toLocaleDateString()}</td>
                      <td className="py-3 pl-3 text-right">
                        <button className="text-xs font-semibold text-shortage hover:underline" onClick={() => deleteRecord(r.id)}>
                          Delete
                        </button>
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
  );
}

function SettingRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.5">
      <dt className="text-navy/60">{k}</dt>
      <dd className="font-semibold text-navy">{v}</dd>
    </div>
  );
}
