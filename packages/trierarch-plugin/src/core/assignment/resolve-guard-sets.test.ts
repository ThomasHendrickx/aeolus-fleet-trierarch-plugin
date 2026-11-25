import { describe, expect, it } from 'vitest';

import { resolveGuardSets } from './guard-rules.js';

const EMPTY = { floor: [], definitions: [], isReadFailed: false };

describe('resolve guard sets', () => {
  it('identifies an unknown selected rule set', () => {
    expect(resolveGuardSets(EMPTY, 'missing')).toEqual({ isOk: false, error: { kind: 'ruleSetUnknown', name: 'missing' } });
  });

  it('identifies an unavailable floor rule set', () => {
    expect(resolveGuardSets({ ...EMPTY, floor: ['base'] }, undefined)).toEqual({ isOk: false, error: { kind: 'floorUnavailable', name: 'base' } });
  });
});
