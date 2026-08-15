import type { ReactNode } from 'react';
import type { StaffingStatus } from '../lib/types';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy/55">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, description, children, right }: { title: string; description?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-navy">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-navy/50">{description}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const KPI_TONES: Record<string, string> = {
  purple: 'text-primary',
  teal: 'text-teal',
  navy: 'text-navy',
  shortage: 'text-shortage',
  balanced: 'text-balanced',
  surplus: 'text-surplus',
  attention: 'text-attention',
};

export function KpiCard({
  label,
  value,
  tone = 'navy',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof KPI_TONES | string;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-navy/50">{label}</div>
      <div className={`mt-2 text-3xl font-extrabold leading-none sm:text-4xl ${KPI_TONES[tone] ?? 'text-navy'}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-xs text-navy/45">{hint}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<StaffingStatus, string> = {
  SHORTAGE: 'bg-shortage/10 text-shortage',
  BALANCED: 'bg-balanced/10 text-balanced',
  SURPLUS: 'bg-surplus/10 text-surplus',
};

export function StatusBadge({ status }: { status: StaffingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-navy/40">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-shortage">{error}</p>}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-softbg/40 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-navy/70">{title}</p>
      {description && <p className="mt-1 text-xs text-navy/45">{description}</p>}
    </div>
  );
}
