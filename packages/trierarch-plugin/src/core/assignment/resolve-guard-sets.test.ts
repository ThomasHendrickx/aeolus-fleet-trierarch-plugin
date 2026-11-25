import { describe, expect, it } from 'vitest';

import { resolveGuardSets } from './resolve-guard-sets.js';

const EMPTY = { floor: [], definitions: [], isReadFailed: false };

describe('resolve guard sets', () => {
  it('identifies an unknown selected rule set', () => {
    expect(resolveGuardSets(EMPTY, 'missing')).toEqual({ isOk: false, error: { kind: 'ruleSetUnknown', name: 'missing' } });
  });

  it('identifies an unavailable floor rule set', () => {
    expect(resolveGuardSets({ ...EMPTY, floor: ['base'] }, undefined)).toEqual({ isOk: false, error: { kind: 'floorUnavailable', name: 'base' } });
  });
});

it('resolves the floor before a selected rule set', () => {
  const base = { name: 'base', repository: 'fleet/rules', commit: 'a', file: 'base.yaml', rules: {} };
  const selected = { name: 'selected', repository: 'fleet/rules', commit: 'b', file: 'selected.yaml', rules: {} };
  expect(resolveGuardSets({ ...EMPTY, floor: ['base'], definitions: [base, selected] }, 'selected')).toEqual({
    isOk: true,
    value: [{ ...base, floor: true }, { ...selected, floor: false }],
  });
});
