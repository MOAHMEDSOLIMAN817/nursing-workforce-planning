import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ExecutiveOverview } from './pages/ExecutiveOverview';
import { PhysiciansPlanning } from './pages/PhysiciansPlanning';
import { NursesPlanning } from './pages/NursesPlanning';
import { CurrentWorkforce } from './pages/CurrentWorkforce';
import { OvertimePlanning } from './pages/OvertimePlanning';
import { CostAnalysis } from './pages/CostAnalysis';
import { Dashboard } from './pages/Dashboard';
import { WorkforcePlanning } from './pages/WorkforcePlanning';
import { ScenarioPlanning } from './pages/ScenarioPlanning';
import { Departments } from './pages/Departments';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <Layout>
      <Routes>
        {/* Primary healthcare workforce modules */}
        <Route path="/" element={<ExecutiveOverview />} />
        <Route path="/physicians" element={<PhysiciansPlanning />} />
        <Route path="/nurses" element={<NursesPlanning />} />
        <Route path="/current-workforce" element={<CurrentWorkforce />} />
        <Route path="/overtime" element={<OvertimePlanning />} />
        <Route path="/cost" element={<CostAnalysis />} />
        <Route path="/scenario" element={<ScenarioPlanning />} />
        <Route path="/settings" element={<Settings />} />

        {/* Supporting nursing tools (existing MVP — preserved) */}
        <Route path="/nurse-calculator" element={<WorkforcePlanning />} />
        <Route path="/nurses-dashboard" element={<Dashboard />} />
        <Route path="/departments" element={<Departments />} />
        <Route path="/reports" element={<Reports />} />

        {/* Backward-compatible alias for the original single-department nurse form */}
        <Route path="/planning" element={<Navigate to="/nurse-calculator" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
