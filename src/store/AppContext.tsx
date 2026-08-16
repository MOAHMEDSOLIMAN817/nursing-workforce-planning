import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  Department,
  NurseUnit,
  PhysicianUnit,
  PlanningRecord,
  Settings,
  UnitConfig,
  UnitMapping,
} from '../lib/types';
import {
  derivePhysicianUnits,
  deriveNurseUnits,
  deriveDepartments,
  reconcilePhysicianUnits,
  reconcileNurseUnits,
} from '../lib/units';
import {
  DEFAULT_HOSPITAL,
  loadRecords,
  loadSettings,
  loadUnitMappings,
  loadUnits,
  saveRecords,
  saveSettings,
  saveUnitMappings,
  saveUnits,
} from './storage';

interface AppState {
  hospital: string;
  settings: Settings;
  // Single source of truth for every operational unit.
  units: UnitConfig[];
  // Derived, read-only per-workforce / legacy views.
  departments: Department[];
  physicianUnits: PhysicianUnit[];
  nurseUnits: NurseUnit[];
  records: PlanningRecord[];
  unitMappings: UnitMapping[];
  // period selector shown in the header
  period: { month: number; year: number };
  setPeriod: (p: { month: number; year: number }) => void;
  updateSettings: (s: Settings) => void;
  // Master (Departments page) operations on the central store.
  setUnits: (u: UnitConfig[]) => void;
  updateUnit: (id: string, patch: Partial<UnitConfig>) => void;
  addUnit: (u: UnitConfig) => void;
  removeUnit: (id: string) => void;
  // Per-workforce setters used by the planning pages; edits are reconciled back
  // into the central store without disturbing the other workforce.
  setPhysicianUnits: (u: PhysicianUnit[]) => void;
  setNurseUnits: (u: NurseUnit[]) => void;
  setUnitMappings: (m: UnitMapping[]) => void;
  addRecord: (r: PlanningRecord) => void;
  deleteRecord: (id: string) => void;
}

const AppCtx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [units, setUnitsState] = useState<UnitConfig[]>(() => loadUnits());
  const [records, setRecords] = useState<PlanningRecord[]>(() => loadRecords());
  const [unitMappings, setUnitMappingsState] = useState<UnitMapping[]>(() => loadUnitMappings());
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveUnits(units), [units]);
  useEffect(() => saveRecords(records), [records]);
  useEffect(() => saveUnitMappings(unitMappings), [unitMappings]);

  // Derived views — recomputed only when the central store changes.
  const physicianUnits = useMemo(() => derivePhysicianUnits(units), [units]);
  const nurseUnits = useMemo(() => deriveNurseUnits(units), [units]);
  const departments = useMemo(() => deriveDepartments(units), [units]);

  const updateSettings = useCallback((s: Settings) => setSettings(s), []);
  const setUnits = useCallback((u: UnitConfig[]) => setUnitsState(u), []);
  const updateUnit = useCallback(
    (id: string, patch: Partial<UnitConfig>) =>
      setUnitsState((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u))),
    [],
  );
  const addUnit = useCallback((u: UnitConfig) => setUnitsState((prev) => [...prev, u]), []);
  const removeUnit = useCallback(
    (id: string) => setUnitsState((prev) => prev.filter((u) => u.id !== id)),
    [],
  );
  const setPhysicianUnits = useCallback(
    (next: PhysicianUnit[]) => setUnitsState((prev) => reconcilePhysicianUnits(prev, next)),
    [],
  );
  const setNurseUnits = useCallback(
    (next: NurseUnit[]) => setUnitsState((prev) => reconcileNurseUnits(prev, next)),
    [],
  );
  const setUnitMappings = useCallback((m: UnitMapping[]) => setUnitMappingsState(m), []);
  const addRecord = useCallback((r: PlanningRecord) => setRecords((prev) => [r, ...prev]), []);
  const deleteRecord = useCallback(
    (id: string) => setRecords((prev) => prev.filter((r) => r.id !== id)),
    [],
  );

  const value = useMemo<AppState>(
    () => ({
      hospital: DEFAULT_HOSPITAL,
      settings,
      units,
      departments,
      physicianUnits,
      nurseUnits,
      records,
      unitMappings,
      period,
      setPeriod,
      updateSettings,
      setUnits,
      updateUnit,
      addUnit,
      removeUnit,
      setPhysicianUnits,
      setNurseUnits,
      setUnitMappings,
      addRecord,
      deleteRecord,
    }),
    [
      settings,
      units,
      departments,
      physicianUnits,
      nurseUnits,
      records,
      unitMappings,
      period,
      updateSettings,
      setUnits,
      updateUnit,
      addUnit,
      removeUnit,
      setPhysicianUnits,
      setNurseUnits,
      setUnitMappings,
      addRecord,
      deleteRecord,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
