import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Stethoscope,
  HeartPulse,
  Users,
  Timer,
  Wallet,
  GitBranch,
  SlidersHorizontal,
  Building2,
  FileText,
  Activity,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

// Primary application sections (the eight executive workforce modules).
const PRIMARY: NavItem[] = [
  { to: '/', label: 'Executive Overview', icon: LayoutDashboard, end: true },
  { to: '/physicians', label: 'Physicians Planning', icon: Stethoscope },
  { to: '/nurses', label: 'Nurses Planning', icon: HeartPulse },
  { to: '/current-workforce', label: 'Current Workforce', icon: Users },
  { to: '/overtime', label: 'Overtime Planning', icon: Timer },
  { to: '/cost', label: 'Cost Analysis', icon: Wallet },
  { to: '/scenario', label: 'Scenario Planning', icon: GitBranch },
  { to: '/settings', label: 'Settings / Assumptions', icon: SlidersHorizontal },
];

// Supporting nursing tools carried over from the existing MVP.
const SECONDARY: NavItem[] = [
  { to: '/nurses-dashboard', label: 'Nursing Dashboard', icon: Activity },
  { to: '/departments', label: 'Departments', icon: Building2 },
  { to: '/reports', label: 'Reports', icon: FileText },
];

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
          isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="flex h-full w-64 flex-col bg-deep text-white">
      <div className="flex items-center gap-3 px-5 py-6">
        {/* Hospital logo placeholder */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal">
          <HeartPulse className="h-6 w-6" strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-extrabold tracking-wide">HEALTHCARE</div>
          <div className="text-sm font-extrabold tracking-wide text-white/80">WORKFORCE PLANNING</div>
        </div>
      </div>

      <nav className="mt-1 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {PRIMARY.map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}

        <div className="px-3.5 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-widest text-white/35">
          Nursing Tools
        </div>
        {SECONDARY.map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-white/10 px-5 py-4 text-xs text-white/45">
        <div className="font-semibold text-white/60">Workforce Capacity</div>
        <div>&amp; Staffing Intelligence</div>
      </div>
    </aside>
  );
}
