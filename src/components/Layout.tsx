import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { useApp } from '../store/AppContext';
import { MONTHS } from '../lib/format';

export function Layout({ children }: { children: ReactNode }) {
  const { hospital, period, setPeriod } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i);

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-10 border-b border-border bg-white/90 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <button
                className="btn-ghost !px-2.5 !py-2 lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div>
                <h1 className="text-lg font-bold text-navy">Nursing Workforce Planning</h1>
                <p className="text-xs text-navy/50">Workforce Capacity &amp; Staffing Intelligence</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="hidden rounded-xl bg-softbg px-3 py-2 text-xs font-semibold text-primary sm:inline">
                {hospital}
              </span>
              <select
                className="input !w-auto !py-2 text-sm"
                value={period.month}
                onChange={(e) => setPeriod({ ...period, month: Number(e.target.value) })}
                aria-label="Month"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="input !w-auto !py-2 text-sm"
                value={period.year}
                onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })}
                aria-label="Year"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
