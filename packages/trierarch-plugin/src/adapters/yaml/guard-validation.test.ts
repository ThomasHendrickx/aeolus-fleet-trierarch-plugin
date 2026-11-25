import { describe, expect, it } from 'vitest';

import { guardValidation } from './guard-validation.js';

describe('guard rule set validation', () => {
  it('reads a YAML rule set with the shared rule types', () => {
    expect(guardValidation.read('name: no-push\nrules:\n  git:\n    deny: [push]\n')).toEqual({
      isOk: true, value: { name: 'no-push', rules: { git: { deny: ['push'] } } },
    });
  });

  it('reads a name-only rule set with empty rules', () => {
    expect(guardValidation.read('name: no-push')).toEqual({
      isOk: true, value: { name: 'no-push', rules: {} },
    });
  });

  it('refuses unknown fields inside rules with a content-free reason', () => {
    expect(guardValidation.read('name: no-push\nrules:\n  git:\n    unexpected: test-value')).toEqual({
      isOk: false, error: 'rule set does not match the guard schema',
    });
  });

  it('refuses invalid YAML with a content-free reason', () => {
    expect(guardValidation.read('name: [test-value')).toEqual({
      isOk: false, error: 'rule set is not valid YAML',
    });
  });
});
