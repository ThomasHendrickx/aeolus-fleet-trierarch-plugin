import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { EMPTY_GUARD_CONFIGURATION, type StoredGuardConfiguration } from './guard-configuration.js';
import { createManageGuardConfiguration } from './manage-guard-configuration.js';

function setup() {
  let configuration: StoredGuardConfiguration = EMPTY_GUARD_CONFIGURATION;
  let reads = 0;
  const updated: string[][] = [];
  let isConflicting = false;
  let failure: string | undefined;
  let storedFailure: string | undefined;
  const guard = createManageGuardConfiguration({
    configurations: {
      readConfiguration: () => Promise.resolve(configuration),
      replace: (_fleetId, input) => {
        if (isConflicting) { return Promise.resolve('conflict'); }
        configuration = input.configuration;
        return Promise.resolve('replaced');
      },
    },
    read: (_fleetId, input) => Promise.resolve({ catalogue: { version: input.version, repositories: input.repositories.map((repository) => ({ ...repository, readCommit: null })), floor: [...input.floor], sets: [], errors: storedFailure === undefined ? [] : [{ repository: input.repositories[0]?.repository ?? '', reason: storedFailure }], conflicts: [] }, definitions: [], isReadFailed: false }),
    refresh: (_fleetId, input) => {
      reads++;
      storedFailure = failure;
      updated.push(input.repositories.map(({ repository }) => repository));
      return Promise.resolve({ catalogue: { version: input.version, repositories: input.repositories.map((repository) => ({ ...repository, readCommit: null })), floor: [...input.floor], sets: [], errors: failure === undefined ? [] : [{ repository: input.repositories[0]?.repository ?? '', reason: failure }], conflicts: [] }, definitions: [], isReadFailed: failure !== undefined });
    },
  });
  return { guard, updated, fail: (reason: string) => { failure = reason; }, reads: () => reads, conflict: () => { isConflicting = true; } };
}
const replacement = { expectedVersion: 0, repositories: [{ repository: 'fleet/rules', folder: '', access: 'private' }] as const, floor: ['base'], secrets: ['fleet/rules'], secretValues: { 'fleet/rules': 'test-token' } };

describe('managing guard configuration', () => {
  it('reads exact catalogue metadata and refreshes immediately after replacement', async () => {
    const { guard, reads } = setup();
    expect(await guard.get(FLEET_ID)).toEqual({ version: 0, repositories: [], floor: [], sets: [], errors: [], conflicts: [] });
    expect(await guard.replace(FLEET_ID, replacement)).toMatchObject({ isOk: true, value: { version: 1 } });
    expect(await guard.get(FLEET_ID)).toEqual({ version: 1, repositories: replacement.repositories.map((repository) => ({ ...repository, readCommit: null })), floor: ['base'], sets: [], errors: [], conflicts: [] });
    expect(reads()).toBe(1);
  });

  it('reports a failed first read on replacement and subsequent catalogue reads', async () => {
    const state = setup();
    state.fail('repository unavailable');
    expect(await state.guard.replace(FLEET_ID, replacement)).toMatchObject({ isOk: true, value: {
      version: 1, repositories: [{ repository: 'fleet/rules', readCommit: null }],
      errors: [{ repository: 'fleet/rules', reason: 'repository unavailable' }],
    } });
    expect(await state.guard.get(FLEET_ID)).toMatchObject({
      repositories: [{ repository: 'fleet/rules', readCommit: null }],
      errors: [{ repository: 'fleet/rules', reason: 'repository unavailable' }],
    });
  });

  it('reads the stored catalogue without contacting the source', async () => {
    const state = setup();
    await state.guard.get(FLEET_ID);
    await state.guard.readForAssignment(FLEET_ID);
    expect(state.reads()).toBe(0);
  });

  it('updates one configured repository or all on request', async () => {
    const state = setup();
    const repositories = [...replacement.repositories, { repository: 'fleet/other', folder: '', access: 'public' as const }];
    await state.guard.replace(FLEET_ID, { ...replacement, repositories });
    state.updated.length = 0;
    await state.guard.update(FLEET_ID, 'fleet/other');
    expect(state.updated).toEqual([['fleet/other']]);
    await state.guard.update(FLEET_ID);
    expect(state.updated).toEqual([['fleet/other'], ['fleet/rules', 'fleet/other']]);
  });

  it('reports an update failure while returning the complete stored catalogue', async () => {
    const state = setup();
    await state.guard.replace(FLEET_ID, { ...replacement, repositories: [...replacement.repositories, { repository: 'fleet/other', folder: '', access: 'public' }] });
    state.fail('repository unavailable');
    expect(await state.guard.update(FLEET_ID, 'fleet/rules')).toMatchObject({ isOk: true, value: {
      repositories: [{ repository: 'fleet/rules' }, { repository: 'fleet/other' }],
      errors: [{ repository: 'fleet/rules', reason: 'repository unavailable' }],
    } });
  });

  it('refuses an update for an unknown repository', async () => {
    const state = setup();
    expect(await state.guard.update(FLEET_ID, 'unknown/repository')).toMatchObject({ isOk: false, error: { kind: 'NOT_FOUND' } });
    expect(state.reads()).toBe(0);
  });

  it('reads only newly added repositories when configuration is replaced', async () => {
    const state = setup();
    await state.guard.replace(FLEET_ID, replacement);
    state.updated.length = 0;
    await state.guard.replace(FLEET_ID, { ...replacement, expectedVersion: 1, floor: [] });
    expect(state.updated).toEqual([]);
    await state.guard.replace(FLEET_ID, { ...replacement, expectedVersion: 2, repositories: [...replacement.repositories, { repository: 'fleet/other', folder: '', access: 'public' }] });
    expect(state.updated).toEqual([['fleet/other']]);
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
