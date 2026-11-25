import { expect, it } from 'vitest';

import { areGuardSetsWithinLimit } from './are-guard-sets-within-limit.js';

it('accepts the receiver limit and rejects one byte over it', () => {
  const set = { name: '', repository: 'fleet/rules', commit: 'a', file: 'base.yaml', rules: {}, floor: true };
  const overhead = Buffer.byteLength(JSON.stringify([set]));
  expect(areGuardSetsWithinLimit([{ ...set, name: 'a'.repeat(65536 - overhead) }])).toBe(true);
  expect(areGuardSetsWithinLimit([{ ...set, name: 'a'.repeat(65537 - overhead) }])).toBe(false);
});
