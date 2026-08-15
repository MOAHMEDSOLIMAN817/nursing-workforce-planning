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

  const save = () => {
    if (!(draft.standardMonthlyNurseHours > 0)) return setError('Monthly nurse hours must be greater than 0.');
    if (!(draft.standardWorkingDays > 0)) return setError('Working days must be greater than 0.');
    if (!(draft.surgeryOpdRatio > 0)) return setError('Surgery ratio must be greater than 0.');
    if (!(draft.nonSurgeryClinicsPerNurse > 0)) return setError('Non-surgery clinics per nurse must be greater than 0.');
    setError('');
    updateSettings(draft);
    setSavedMsg('Settings saved. These values now drive all calculations.');
  };

  const restore = () => {
    setDraft(DEFAULT_SETTINGS);
    updateSettings(DEFAULT_SETTINGS);
    setSavedMsg('Defaults restored.');
    setError('');
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configurable defaults consumed by the calculation engine." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Calculation Defaults" description="Never hardcoded — the calculators read these values.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Standard Monthly Nurse Hours">
              <input
                className="input"
                type="number"
                min={1}
                value={draft.standardMonthlyNurseHours}
                onChange={(e) => set({ standardMonthlyNurseHours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Standard Working Days">
              <input
                className="input"
                type="number"
                min={1}
                value={draft.standardWorkingDays}
                onChange={(e) => set({ standardWorkingDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Surgery OPD Ratio" hint="Nurses per surgery clinic (1 : 1 → 1)">
              <input
                className="input"
                type="number"
                min={0.1}
                step={0.1}
                value={draft.surgeryOpdRatio}
                onChange={(e) => set({ surgeryOpdRatio: Number(e.target.value) })}
              />
            </Field>
            <Field label="Non-Surgery OPD Ratio" hint="Clinics per nurse (1 : 5 → 5)">
              <input
                className="input"
                type="number"
                min={1}
                value={draft.nonSurgeryClinicsPerNurse}
                onChange={(e) => set({ nonSurgeryClinicsPerNurse: Number(e.target.value) })}
              />
            </Field>
          </div>

          {error && <p className="mt-3 text-xs font-medium text-shortage">{error}</p>}
          {savedMsg && <p className="mt-3 text-xs font-medium text-balanced">{savedMsg}</p>}

          <div className="mt-5 flex gap-2">
            <button className="btn-primary" onClick={save}>
              Save Settings
            </button>
            <button className="btn-ghost" onClick={restore}>
              Restore Defaults
            </button>
          </div>
        </Section>

        <Section title="Current Values" description="What the engine is using right now.">
          <dl className="divide-y divide-border text-sm">
            <SettingRow k="Standard Monthly Nurse Hours" v={String(settings.standardMonthlyNurseHours)} />
            <SettingRow k="Standard Working Days" v={String(settings.standardWorkingDays)} />
            <SettingRow k="Surgery OPD Ratio" v={`1 Nurse : ${1 / settings.surgeryOpdRatio === 1 ? '1' : (1 / settings.surgeryOpdRatio).toFixed(2)} Clinic`} />
            <SettingRow k="Non-Surgery OPD Ratio" v={`1 Nurse : ${settings.nonSurgeryClinicsPerNurse} Clinics`} />
          </dl>
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Saved Planning History" description={`${records.length} saved record${records.length === 1 ? '' : 's'} (persisted locally).`}>
          {records.length === 0 ? (
            <EmptyState title="No saved records" description="Save a calculation from Workforce Planning." />
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
                      <td className="py-3 px-3 text-navy/60">
                        {monthName(r.month)} {r.year}
                      </td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.currentHc)}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.requiredHc)}</td>
                      <td className="py-3 px-3 text-right text-navy/80">{fmtInt(r.requiredHours)}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            r.status === 'SHORTAGE'
                              ? 'bg-shortage/10 text-shortage'
                              : r.status === 'SURPLUS'
                                ? 'bg-surplus/10 text-surplus'
                                : 'bg-balanced/10 text-balanced'
                          }`}
                        >
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
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-navy/60">{k}</dt>
      <dd className="font-semibold text-navy">{v}</dd>
    </div>
  );
}
