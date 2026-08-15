import { describe, it, expect } from 'vitest';
import { resolveMapping, validateMapping } from './unitMapping';
import type { UnitMapping } from '../lib/types';

const existing: UnitMapping[] = [
  { id: '1', sourceName: 'Riyadh PICU - NU', workforceType: 'Nurse', planningUnitId: 'nurse-picu' },
];

describe('validateMapping — one source maps to exactly one planning unit', () => {
  it('accepts a new, unique source name', () => {
    expect(
      validateMapping({ sourceName: 'PICU Physicians', workforceType: 'Physician', planningUnitId: 'phys-picu' }, existing),
    ).toBeNull();
  });

  it('rejects a duplicate source name (case-insensitive) — no duplicate counting', () => {
    const err = validateMapping(
      { sourceName: 'riyadh picu - nu', workforceType: 'Nurse', planningUnitId: 'nurse-other' },
      existing,
    );
    expect(err).toMatch(/already mapped/i);
  });

  it('requires a source name and a planning unit', () => {
    expect(validateMapping({ sourceName: '  ', workforceType: 'Nurse', planningUnitId: 'x' }, existing)).toMatch(/required/i);
    expect(validateMapping({ sourceName: 'New', workforceType: 'Nurse', planningUnitId: '' }, existing)).toMatch(/planning unit/i);
  });

  it('lets an edit keep its own source name via ignoreId', () => {
    expect(
      validateMapping({ sourceName: 'Riyadh PICU - NU', workforceType: 'Nurse', planningUnitId: 'nurse-picu' }, existing, '1'),
    ).toBeNull();
  });
});

describe('resolveMapping', () => {
  it('resolves a source name to its single mapping', () => {
    expect(resolveMapping('riyadh picu - nu', existing)?.planningUnitId).toBe('nurse-picu');
  });
  it('returns undefined for an unmapped source', () => {
    expect(resolveMapping('Unknown Ward', existing)).toBeUndefined();
  });
});
