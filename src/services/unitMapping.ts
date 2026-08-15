// Explicit unit-mapping layer.
//
// Actual/source workforce data often names a unit differently from the planning
// model ("PICU", "PICU - NU", "Riyadh PICU - NU" are one operational unit). This
// module keeps a configurable, non-fuzzy map: each source name resolves to
// exactly one planning unit, so a Current FTE record can never be counted
// against two units.

import type { UnitMapping, WorkforceType } from '../lib/types';

const norm = (s: string): string => s.trim().toLowerCase();

export interface NewMapping {
  sourceName: string;
  workforceType: WorkforceType;
  planningUnitId: string;
}

// Validate a candidate mapping against the existing set. Returns an error string
// or null when valid. `ignoreId` lets an edit skip its own row in the dup check.
export function validateMapping(
  candidate: NewMapping,
  existing: UnitMapping[],
  ignoreId?: string,
): string | null {
  if (!candidate.sourceName.trim()) return 'Source name is required.';
  if (!candidate.planningUnitId) return 'Select a planning unit.';
  const dup = existing.some(
    (m) => m.id !== ignoreId && norm(m.sourceName) === norm(candidate.sourceName),
  );
  if (dup) return 'This source name is already mapped — a source can map to only one unit.';
  return null;
}

// Resolve a source name to its single mapping (case-insensitive), or undefined.
export function resolveMapping(
  sourceName: string,
  mappings: UnitMapping[],
): UnitMapping | undefined {
  const key = norm(sourceName);
  return mappings.find((m) => norm(m.sourceName) === key);
}
