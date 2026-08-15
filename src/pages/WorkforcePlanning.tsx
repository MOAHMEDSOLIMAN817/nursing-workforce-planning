import { useMemo, useState } from 'react';
import { PageHeader, Section, KpiCard, StatusBadge, Field, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { calcInpatient, calcOpd, buildCommentary } from '../lib/calc';
import { validatePlanning, type ValidationErrors } from '../lib/validation';
import { fmt, fmtInt, monthName, uid, MONTHS } from '../lib/format';
import type {
  CalcResult,
  DepartmentType,
  InpatientBreakdown,
  InpatientInputs,
  OpdBreakdown,
  OpdInputs,
  PlanningRecord,
} from '../lib/types';

interface FormState {
  department: string;
  departmentType: DepartmentType;
  month: number;
  year: number;
  currentHc: string;
  monthlyNurseHours: string;
  // Inpatient
  beds: string;
  occupancyRate: string;
  nurseRatio: string;
  coverageHours: string;
  workingDays: string;
  // OPD
  surgeryClinics: string;
  nonSurgeryClinics: string;
  operatingHours: string;
}

type CalcOutput =
  | { type: 'Inpatient'; result: CalcResult; breakdown: InpatientBreakdown; inputs: InpatientInputs }
  | { type: 'OPD'; result: CalcResult; breakdown: OpdBreakdown; inputs: OpdInputs };

const numOr = (s: string): number => (s.trim() === '' ? NaN : Number(s));

export function WorkforcePlanning() {
  const { hospital, settings, departments, period, addRecord } = useApp();
  const activeDepts = useMemo(() => departments.filter((d) => d.active), [departments]);

  const [form, setForm] = useState<FormState>(() => {
    const first = departments.find((d) => d.active) ?? departments[0];
    return {
      department: first?.name ?? '',
      departmentType: first?.type ?? 'Inpatient',
      month: period.month,
      year: period.year,
      currentHc: '',
      monthlyNurseHours: String(settings.standardMonthlyNurseHours),
      beds: '',
      occupancyRate: '80',
      nurseRatio: String(first?.defaultNurseRatio || 2),
      coverageHours: String(first?.defaultCoverageHours || 24),
      workingDays: String(settings.standardWorkingDays),
      surgeryClinics: '',
      nonSurgeryClinics: '',
      operatingHours: '10',
    };
  });

  const [errors, setErrors] = useState<ValidationErrors>({});
  const [output, setOutput] = useState<CalcOutput | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const onDepartmentChange = (name: string) => {
    const dept = departments.find((d) => d.name === name);
    if (!dept) return set({ department: name });
    set({
      department: dept.name,
      departmentType: dept.type,
      nurseRatio: dept.defaultNurseRatio ? String(dept.defaultNurseRatio) : form.nurseRatio,
      coverageHours: dept.defaultCoverageHours ? String(dept.defaultCoverageHours) : form.coverageHours,
    });
    setOutput(null);
  };

  const handleCalculate = () => {
    const isInpatient = form.departmentType === 'Inpatient';
    const validationInput = {
      departmentType: form.departmentType,
      currentHc: numOr(form.currentHc),
      monthlyNurseHours: numOr(form.monthlyNurseHours),
      ...(isInpatient
        ? {
            beds: numOr(form.beds),
            occupancyRate: numOr(form.occupancyRate),
            nurseRatio: numOr(form.nurseRatio),
            coverageHours: numOr(form.coverageHours),
            workingDays: numOr(form.workingDays),
          }
        : {
            surgeryClinics: numOr(form.surgeryClinics),
            nonSurgeryClinics: numOr(form.nonSurgeryClinics),
            operatingHours: numOr(form.operatingHours),
            workingDays: numOr(form.workingDays),
          }),
    };

    // Guard against missing required numbers first.
    const requiredFields = isInpatient
      ? ['currentHc', 'monthlyNurseHours', 'beds', 'occupancyRate', 'nurseRatio', 'coverageHours', 'workingDays']
      : ['currentHc', 'monthlyNurseHours', 'surgeryClinics', 'nonSurgeryClinics', 'operatingHours', 'workingDays'];
    const missing: ValidationErrors = {};
    for (const key of requiredFields) {
      if (Number.isNaN((form as any)[key] === undefined ? NaN : numOr((form as any)[key]))) {
        missing[key] = 'This field is required.';
      }
    }

    const rangeErrors = validatePlanning(validationInput);
    const allErrors = { ...missing, ...rangeErrors };
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      setOutput(null);
      return;
    }

    const currentHc = numOr(form.currentHc);
    const monthlyNurseHours = numOr(form.monthlyNurseHours);

    if (isInpatient) {
      const inputs: InpatientInputs = {
        beds: numOr(form.beds),
        occupancyRate: numOr(form.occupancyRate),
        nurseRatio: numOr(form.nurseRatio),
        coverageHours: numOr(form.coverageHours),
        workingDays: numOr(form.workingDays),
      };
      const { breakdown, result } = calcInpatient(inputs, currentHc, monthlyNurseHours);
      setOutput({ type: 'Inpatient', result, breakdown, inputs });
    } else {
      const inputs: OpdInputs = {
        surgeryClinics: numOr(form.surgeryClinics),
        nonSurgeryClinics: numOr(form.nonSurgeryClinics),
        operatingHours: numOr(form.operatingHours),
        workingDays: numOr(form.workingDays),
      };
      const { breakdown, result } = calcOpd(inputs, currentHc, monthlyNurseHours, settings);
      setOutput({ type: 'OPD', result, breakdown, inputs });
    }
    setSaved(false);
  };

  const handleSave = () => {
    if (!output) return;
    const record: PlanningRecord = {
      id: uid(),
      hospital,
      department: form.department,
      departmentType: form.departmentType,
      month: form.month,
      year: form.year,
      monthlyNurseHours: numOr(form.monthlyNurseHours),
      inputs: output.inputs,
      currentHc: output.result.currentHc,
      requiredHc: output.result.requiredHc,
      requiredHours: output.result.requiredHours,
      gap: output.result.gap,
      status: output.result.status,
      calculationDate: new Date().toISOString(),
    };
    addRecord(record);
    setSaved(true);
  };

  const isInpatient = form.departmentType === 'Inpatient';
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);

  return (
    <div>
      <PageHeader
        title="Workforce Planning"
        subtitle="Calculate required nursing headcount for a department and save it to the plan."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Form */}
        <div className="xl:col-span-3">
          <Section title="Planning Inputs" description="General details and department-specific parameters.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Hospital">
                <input className="input" value={hospital} readOnly />
              </Field>

              <Field label="Department">
                <select className="input" value={form.department} onChange={(e) => onDepartmentChange(e.target.value)}>
                  {activeDepts.length === 0 && <option value="">No active departments</option>}
                  {activeDepts.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Department Type">
                <select
                  className="input"
                  value={form.departmentType}
                  onChange={(e) => {
                    set({ departmentType: e.target.value as DepartmentType });
                    setOutput(null);
                  }}
                >
                  <option value="Inpatient">Inpatient</option>
                  <option value="OPD">OPD</option>
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Planning Month">
                  <select className="input" value={form.month} onChange={(e) => set({ month: Number(e.target.value) })}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Planning Year">
                  <select className="input" value={form.year} onChange={(e) => set({ year: Number(e.target.value) })}>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Current Nursing HC" error={errors.currentHc}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.currentHc}
                  onChange={(e) => set({ currentHc: e.target.value })}
                  placeholder="e.g. 22"
                />
              </Field>

              <Field label="Working Hours / Nurse / Month" error={errors.monthlyNurseHours}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.monthlyNurseHours}
                  onChange={(e) => set({ monthlyNurseHours: e.target.value })}
                />
              </Field>
            </div>

            {/* Type-specific fields */}
            <div className="mt-5 rounded-xl bg-softbg/50 p-4">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-primary">
                {isInpatient ? 'Inpatient Parameters' : 'OPD Parameters'}
              </div>

              {isInpatient ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Number of Beds" error={errors.beds}>
                    <input className="input" type="number" min={0} value={form.beds} onChange={(e) => set({ beds: e.target.value })} placeholder="e.g. 20" />
                  </Field>
                  <Field label="Occupancy Rate %" error={errors.occupancyRate}>
                    <input className="input" type="number" min={0} max={100} value={form.occupancyRate} onChange={(e) => set({ occupancyRate: e.target.value })} />
                  </Field>
                  <Field label="Nurse : Patient Ratio (1 : N)" error={errors.nurseRatio} hint="Patients per nurse">
                    <input className="input" type="number" min={1} value={form.nurseRatio} onChange={(e) => set({ nurseRatio: e.target.value })} />
                  </Field>
                  <Field label="Coverage Hours / Day" error={errors.coverageHours}>
                    <input className="input" type="number" min={0} value={form.coverageHours} onChange={(e) => set({ coverageHours: e.target.value })} />
                  </Field>
                  <Field label="Working Days / Month" error={errors.workingDays}>
                    <input className="input" type="number" min={0} value={form.workingDays} onChange={(e) => set({ workingDays: e.target.value })} />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Active Surgery Clinics" error={errors.surgeryClinics}>
                    <input className="input" type="number" min={0} value={form.surgeryClinics} onChange={(e) => set({ surgeryClinics: e.target.value })} placeholder="e.g. 8" />
                  </Field>
                  <Field label="Active Non-Surgery Clinics" error={errors.nonSurgeryClinics}>
                    <input className="input" type="number" min={0} value={form.nonSurgeryClinics} onChange={(e) => set({ nonSurgeryClinics: e.target.value })} placeholder="e.g. 20" />
                  </Field>
                  <Field label="Operating Hours / Day" error={errors.operatingHours}>
                    <input className="input" type="number" min={0} value={form.operatingHours} onChange={(e) => set({ operatingHours: e.target.value })} />
                  </Field>
                  <Field label="Working Days / Month" error={errors.workingDays}>
                    <input className="input" type="number" min={0} value={form.workingDays} onChange={(e) => set({ workingDays: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button className="btn-primary" onClick={handleCalculate}>
                Calculate
              </button>
              <button className="btn-teal" onClick={handleSave} disabled={!output}>
                Save to Plan
              </button>
              {saved && <span className="text-sm font-semibold text-balanced">Saved ✓</span>}
            </div>
          </Section>
        </div>

        {/* Results */}
        <div className="xl:col-span-2">
          {output ? (
            <ResultPanel form={form} output={output} />
          ) : (
            <Section title="Results" description="Run a calculation to see KPI cards and breakdown.">
              <EmptyState title="No calculation yet" description="Enter parameters and press Calculate." />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ form, output }: { form: FormState; output: CalcOutput }) {
  const { result } = output;
  const gapTone = result.status === 'SHORTAGE' ? 'shortage' : result.status === 'SURPLUS' ? 'surplus' : 'balanced';
  const commentary = buildCommentary(form.department || 'This department', result.status, result.shortage, result.surplus);

  return (
    <div className="space-y-4">
      <Section title="Results" description={`${form.department} · ${monthName(form.month)} ${form.year}`}>
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Current HC" value={fmtInt(result.currentHc)} tone="teal" />
          <KpiCard label="Required HC" value={fmtInt(result.requiredHc)} tone="purple" />
          <KpiCard label="Gap" value={result.gap > 0 ? `+${fmtInt(result.gap)}` : fmtInt(result.gap)} tone={gapTone} />
          <div className="card flex flex-col justify-center p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-navy/50">Status</div>
            <div className="mt-2">
              <StatusBadge status={result.status} />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <KpiCard label="Required Nursing Hours" value={fmtInt(result.requiredHours)} tone="navy" hint="Concurrent nurses × coverage × working days" />
        </div>
        <div className="mt-3 rounded-xl bg-softbg/60 px-4 py-3 text-sm text-navy/75">{commentary}</div>
      </Section>

      <Section title="Calculation Breakdown">
        {output.type === 'Inpatient' ? (
          <dl className="divide-y divide-border text-sm">
            <Row k="Occupied Beds" v={fmt(output.breakdown.occupiedBeds)} />
            <Row k="Concurrent Nurses" v={fmt(output.breakdown.concurrentNurses)} />
            <Row k="Required Hours" v={fmtInt(output.breakdown.requiredHours)} />
            <Row k="Required HC (rounded up)" v={fmtInt(output.breakdown.requiredHc)} strong />
          </dl>
        ) : (
          <dl className="divide-y divide-border text-sm">
            <Row k="Surgery Requirement" v={fmt(output.breakdown.surgeryRequirement)} />
            <Row k="Non-Surgery Requirement" v={fmt(output.breakdown.nonSurgeryRequirement)} />
            <Row k="Concurrent Nurses" v={fmt(output.breakdown.concurrentNurses)} />
            <Row k="Required Hours" v={fmtInt(output.breakdown.requiredHours)} />
            <Row k="Required HC (rounded up)" v={fmtInt(output.breakdown.requiredHc)} strong />
          </dl>
        )}
      </Section>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-navy/60">{k}</dt>
      <dd className={strong ? 'font-bold text-primary' : 'font-semibold text-navy'}>{v}</dd>
    </div>
  );
}
