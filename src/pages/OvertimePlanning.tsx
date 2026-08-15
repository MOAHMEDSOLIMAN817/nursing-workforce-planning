import { Timer } from 'lucide-react';
import { PageHeader, ComingSoon } from '../components/ui';

export function OvertimePlanning() {
  return (
    <div>
      <PageHeader
        title="Overtime Planning"
        subtitle="Model overtime demand and relief coverage needed to close staffing gaps."
      />
      <ComingSoon
        icon={<Timer className="h-7 w-7" />}
        title="Overtime engine not implemented yet"
        description="This module is scaffolded. Overtime calculations will build on the same global assumptions (shift length, relief factor, minimum staff per shift) once the physician and nurse plans are finalised."
        planned={[
          'Overtime hours to cover shortages',
          'Relief-factor uplift on required FTE',
          'Cost of overtime vs. new hires',
          'Per-unit overtime exposure',
        ]}
      />
    </div>
  );
}
