import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { EMPTY_GUARD_CONFIGURATION, type StoredGuardConfiguration } from './guard-configuration.js';
import { createManageGuardConfiguration } from './manage-guard-configuration.js';

function setup() {
  let configuration: StoredGuardConfiguration = EMPTY_GUARD_CONFIGURATION;
  let now = 0;
  let reads = 0;
  let isConflicting = false;
  const guard = createManageGuardConfiguration({
    configurations: {
      readConfiguration: () => Promise.resolve(configuration),
      replace: (_fleetId, input) => {
        if (isConflicting) { return Promise.resolve('conflict'); }
        configuration = input.configuration;
        return Promise.resolve('replaced');
      },
    },
    clock: { now: () => new Date(now) },
    refresh: (_fleetId, input) => {
      reads++;
      return Promise.resolve({ catalogue: { version: input.version, repositories: [...input.repositories], floor: [...input.floor], sets: [], errors: [], conflicts: [] }, definitions: [], isReadFailed: false });
    },
  });
  return { guard, reads: () => reads, advance: (milliseconds: number) => { now += milliseconds; }, conflict: () => { isConflicting = true; } };
}
const replacement = { expectedVersion: 0, repositories: [{ repository: 'fleet/rules', folder: '', access: 'private' }] as const, floor: ['base'], secrets: ['fleet/rules'], secretValues: { 'fleet/rules': 'test-token' } };

describe('managing guard configuration', () => {
  it('reads exact catalogue metadata and refreshes immediately after replacement', async () => {
    const { guard, reads } = setup();
    expect(await guard.get(FLEET_ID)).toEqual({ version: 0, repositories: [], floor: [], sets: [], errors: [], conflicts: [] });
    expect(await guard.replace(FLEET_ID, replacement)).toEqual({ isOk: true, value: { version: 1 } });
    expect(await guard.get(FLEET_ID)).toEqual({ version: 1, repositories: replacement.repositories, floor: ['base'], sets: [], errors: [], conflicts: [] });
    expect(reads()).toBe(2);
  });

  it('refreshes at exactly five minutes and avoids overlapping reads for a fleet', async () => {
    const state = setup();
    await Promise.all([state.guard.get(FLEET_ID), state.guard.get(FLEET_ID)]);
    expect(state.reads()).toBe(1);
    state.advance(299999);
    await state.guard.get(FLEET_ID);
    expect(state.reads()).toBe(1);
    state.advance(1);
    await state.guard.get(FLEET_ID);
    expect(state.reads()).toBe(2);
  });

  it('refuses a concurrent store replacement without refreshing or exposing tokens', async () => {
    const state = setup();
    state.conflict();
    expect(await state.guard.replace(FLEET_ID, replacement)).toMatchObject({ isOk: false, error: { kind: 'VERSION_CONFLICT' } });
    expect(state.reads()).toBe(0);
  });

  it('refuses invalid configuration before writing or refreshing', async () => {
    const state = setup();
    expect(await state.guard.replace(FLEET_ID, { ...replacement, secrets: [], secretValues: {} })).toMatchObject({ isOk: false, error: { kind: 'INVALID_CONFIGURATION' } });
    expect(state.reads()).toBe(0);
    expect((await state.guard.get(FLEET_ID)).version).toBe(0);
  });
});
