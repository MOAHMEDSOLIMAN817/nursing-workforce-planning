// Lightweight dependency-free grouped bar chart: Current vs Required by department.

import { fmtInt } from '../lib/format';

export interface BarDatum {
  label: string;
  current: number;
  required: number;
}

export function BarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.current, d.required)));
  const ticks = 4;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs font-medium text-navy/60">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-teal" /> Current HC
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-primary" /> Required HC
        </span>
      </div>

      <div className="relative overflow-x-auto">
        <div className="flex min-w-[520px] items-end gap-6 border-b border-l border-border pb-0 pl-10 pr-2" style={{ height: 240 }}>
          {/* gridlines + y labels */}
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const val = Math.round((max / ticks) * (ticks - i));
            const top = (i / ticks) * 200;
            return (
              <div key={i} className="pointer-events-none absolute left-0 right-0" style={{ top }}>
                <span className="absolute -left-0 -translate-y-1/2 text-[10px] text-navy/35">{val}</span>
                <div className="ml-9 border-t border-dashed border-border/70" />
              </div>
            );
          })}

          {data.map((d) => (
            <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-2">
              <div className="flex items-end gap-1.5" style={{ height: 200 }}>
                <div className="group relative flex flex-col items-center justify-end">
                  <span className="mb-1 text-[10px] font-semibold text-navy/50">{fmtInt(d.current)}</span>
                  <div
                    className="w-6 rounded-t-md bg-teal transition-all sm:w-8"
                    style={{ height: `${(d.current / max) * 190}px` }}
                    title={`Current: ${fmtInt(d.current)}`}
                  />
                </div>
                <div className="group relative flex flex-col items-center justify-end">
                  <span className="mb-1 text-[10px] font-semibold text-navy/50">{fmtInt(d.required)}</span>
                  <div
                    className="w-6 rounded-t-md bg-primary transition-all sm:w-8"
                    style={{ height: `${(d.required / max) * 190}px` }}
                    title={`Required: ${fmtInt(d.required)}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex min-w-[520px] gap-6 pl-10 pr-2 pt-2">
          {data.map((d) => (
            <div key={d.label} className="flex-1 truncate text-center text-[11px] font-medium text-navy/60" title={d.label}>
              {d.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
