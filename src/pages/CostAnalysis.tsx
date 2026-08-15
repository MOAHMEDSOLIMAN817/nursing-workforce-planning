import { Wallet } from 'lucide-react';
import { PageHeader, ComingSoon } from '../components/ui';

export function CostAnalysis() {
  return (
    <div>
      <PageHeader
        title="Cost Analysis"
        subtitle="Translate the workforce plan into salary, overtime and gap-closure costs."
      />
      <ComingSoon
        icon={<Wallet className="h-7 w-7" />}
        title="Cost model not implemented yet"
        description="This module is scaffolded. Cost calculations will consume the required-headcount and gap figures produced by the physician and nurse engines."
        planned={[
          'Annual cost of required headcount',
          'Cost of current vs. required staffing',
          'Overtime cost exposure',
          'Cost to close each unit gap',
        ]}
      />
    </div>
  );
}
