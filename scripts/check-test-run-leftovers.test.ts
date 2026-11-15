import { describe, expect, it } from 'vitest';

import { TEST_RUN_LABEL, leftoversOf } from './check-test-run-leftovers.ts';

describe('the test run leftovers check', () => {
  it('finds nothing when no container carries the run label and no volume is unused', () => {
    expect(leftoversOf([], [])).toEqual([]);
  });

  it('names a container of a test run, with its image and state', () => {
    const container = { Id: 'abc123', Image: 'postgres:16-alpine', State: 'running', Labels: { [TEST_RUN_LABEL]: 'run-1' } };

    expect(leftoversOf([container], [])).toEqual(['container abc123 (postgres:16-alpine, running) of test run run-1']);
  });

  it('names a volume that no container uses', () => {
    expect(leftoversOf([], [{ Name: 'vol-9' }])).toEqual(['volume vol-9, used by no container']);
  });
});
