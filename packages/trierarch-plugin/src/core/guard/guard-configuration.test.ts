import { describe, expect, it } from 'vitest';

import { replaceGuardConfiguration, EMPTY_GUARD_CONFIGURATION } from './guard-configuration.js';

const repository = { repository: 'fleet/rules', folder: 'guard', access: 'private' } as const;
const replacement = { expectedVersion: 0, repositories: [repository], floor: ['missing'], secrets: ['fleet/rules'], secretValues: { 'fleet/rules': 'test-token' } };

describe('replacing the guard configuration', () => {
  it('moves one version and retains private tokens by repository without requiring the floor to be offered', () => {
    const first = replaceGuardConfiguration(EMPTY_GUARD_CONFIGURATION, replacement);
    expect(first).toEqual({ isOk: true, value: { version: 1, repositories: [repository], floor: ['missing'], secrets: [{ name: 'fleet/rules', value: 'test-token' }] } });
    if (!first.isOk) { return; }
    expect(replaceGuardConfiguration(first.value, { ...replacement, expectedVersion: 1, secretValues: {} })).toEqual({ isOk: true, value: { ...first.value, version: 2 } });
  });

  it('refuses a stale version', () => {
    expect(replaceGuardConfiguration(EMPTY_GUARD_CONFIGURATION, { ...replacement, expectedVersion: 1 })).toMatchObject({ isOk: false, error: { kind: 'VERSION_CONFLICT' } });
  });

  it.each([
    { secrets: [], secretValues: {} },
    { secrets: ['fleet/rules'], secretValues: {} },
    { secrets: ['fleet/rules'], secretValues: { 'fleet/rules': '' } },
    { secrets: ['fleet/rules'], secretValues: { 'fleet/rules': 'bad\nvalue' } },
    { secrets: ['fleet/rules', 'fleet/rules'] },
    { secrets: ['fleet/other'] },
    { secretValues: { 'fleet/other': 'value' } },
    { repositories: [{ ...repository, access: 'public' }] },
    { repositories: [repository, repository] },
    { repositories: [{ ...repository, repository: 'https://user:token@host/repo' }] },
    { repositories: [{ ...repository, folder: '../guard' }] },
    { repositories: [{ ...repository, folder: '/guard' }] },
    { floor: ['Bad Name'] },
    { floor: ['base', 'base'] },
  ])('refuses invalid configuration without including token values: %j', (change) => {
    const result = replaceGuardConfiguration(EMPTY_GUARD_CONFIGURATION, { ...replacement, ...change });
    expect(result).toMatchObject({ isOk: false, error: { kind: 'INVALID_CONFIGURATION' } });
    expect(JSON.stringify(result)).not.toContain('test-token');
  });

  it('removes tokens when their private repository is removed', () => {
    const current = { version: 1, repositories: [repository], floor: [], secrets: [{ name: 'fleet/rules', value: 'test-token' }] };
    expect(replaceGuardConfiguration(current, { expectedVersion: 1, repositories: [], floor: [], secrets: [], secretValues: {} })).toEqual({ isOk: true, value: { version: 2, repositories: [], floor: [], secrets: [] } });
  });
});
