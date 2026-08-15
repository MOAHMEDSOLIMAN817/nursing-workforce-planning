// Aggregation helpers that turn saved planning records into dashboard/report rows.

import type { PlanningRecord, StaffingStatus } from './types';
import { determineStatus } from './calc';

export interface DeptSummary {
  department: string;
  departmentType: string;
  currentHc: number;
  requiredHc: number;
  gap: number;
  shortage: number;
  surplus: number;
  status: StaffingStatus;
}

export interface RecordFilter {
  hospital?: string;
  department?: string;
  month?: number;
  year?: number;
}

export function filterRecords(records: PlanningRecord[], f: RecordFilter): PlanningRecord[] {
  return records.filter((r) => {
    if (f.hospital && r.hospital !== f.hospital) return false;
    if (f.department && r.department !== f.department) return false;
    if (f.month && r.month !== f.month) return false;
    if (f.year && r.year !== f.year) return false;
    return true;
  });
}

// Keep only the most recent record per department (by calculationDate).
export function latestPerDepartment(records: PlanningRecord[]): PlanningRecord[] {
  const byDept = new Map<string, PlanningRecord>();
  for (const r of records) {
    const existing = byDept.get(r.department);
    if (!existing || new Date(r.calculationDate) > new Date(existing.calculationDate)) {
      byDept.set(r.department, r);
    }
  }
  return [...byDept.values()];
}

export function toSummary(records: PlanningRecord[]): DeptSummary[] {
  return records
    .map((r) => {
      const gap = r.currentHc - r.requiredHc;
      return {
        department: r.department,
        departmentType: r.departmentType,
        currentHc: r.currentHc,
        requiredHc: r.requiredHc,
        gap,
        shortage: gap < 0 ? -gap : 0,
        surplus: gap > 0 ? gap : 0,
        status: determineStatus(r.currentHc, r.requiredHc),
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department));
}

export interface Totals {
  currentHc: number;
  requiredHc: number;
  shortage: number;
  surplus: number;
  gap: number;
}

export function totals(rows: DeptSummary[]): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      currentHc: acc.currentHc + r.currentHc,
      requiredHc: acc.requiredHc + r.requiredHc,
      shortage: acc.shortage + r.shortage,
      surplus: acc.surplus + r.surplus,
      gap: acc.gap + r.gap,
    }),
    { currentHc: 0, requiredHc: 0, shortage: 0, surplus: 0, gap: 0 },
  );
}
