import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Department, NurseUnit, PhysicianUnit, PlanningRecord, Settings } from '../lib/types';
import {
  DEFAULT_HOSPITAL,
  loadDepartments,
  loadNurseUnits,
  loadPhysicianUnits,
  loadRecords,
  loadSettings,
  saveDepartments,
  saveNurseUnits,
  savePhysicianUnits,
  saveRecords,
  saveSettings,
} from './storage';

interface AppState {
  hospital: string;
  settings: Settings;
  departments: Department[];
  records: PlanningRecord[];
  physicianUnits: PhysicianUnit[];
  nurseUnits: NurseUnit[];
  // period selector shown in the header
  period: { month: number; year: number };
  setPeriod: (p: { month: number; year: number }) => void;
  updateSettings: (s: Settings) => void;
  setDepartments: (d: Department[]) => void;
  setPhysicianUnits: (u: PhysicianUnit[]) => void;
  setNurseUnits: (u: NurseUnit[]) => void;
  addRecord: (r: PlanningRecord) => void;
  deleteRecord: (id: string) => void;
}

const AppCtx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [departments, setDepartmentsState] = useState<Department[]>(() => loadDepartments());
  const [records, setRecords] = useState<PlanningRecord[]>(() => loadRecords());
  const [physicianUnits, setPhysicianUnitsState] = useState<PhysicianUnit[]>(() => loadPhysicianUnits());
  const [nurseUnits, setNurseUnitsState] = useState<NurseUnit[]>(() => loadNurseUnits());
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveDepartments(departments), [departments]);
  useEffect(() => saveRecords(records), [records]);
  useEffect(() => savePhysicianUnits(physicianUnits), [physicianUnits]);
  useEffect(() => saveNurseUnits(nurseUnits), [nurseUnits]);

  const updateSettings = useCallback((s: Settings) => setSettings(s), []);
  const setDepartments = useCallback((d: Department[]) => setDepartmentsState(d), []);
  const setPhysicianUnits = useCallback((u: PhysicianUnit[]) => setPhysicianUnitsState(u), []);
  const setNurseUnits = useCallback((u: NurseUnit[]) => setNurseUnitsState(u), []);
  const addRecord = useCallback(
    (r: PlanningRecord) => setRecords((prev) => [r, ...prev]),
    [],
  );
  const deleteRecord = useCallback(
    (id: string) => setRecords((prev) => prev.filter((r) => r.id !== id)),
    [],
  );

  const value = useMemo<AppState>(
    () => ({
      hospital: DEFAULT_HOSPITAL,
      settings,
      departments,
      records,
      physicianUnits,
      nurseUnits,
      period,
      setPeriod,
      updateSettings,
      setDepartments,
      setPhysicianUnits,
      setNurseUnits,
      addRecord,
      deleteRecord,
    }),
    [settings, departments, records, physicianUnits, nurseUnits, period, updateSettings, setDepartments, setPhysicianUnits, setNurseUnits, addRecord, deleteRecord],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
