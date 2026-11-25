import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { err, ok } from '../shared/result.js';
import type { GuardSnapshot, GuardRepository, GuardConfiguration, GuardSource, GuardValidation } from './ports.js';
import { createReadGuardCatalogue, createRefreshGuardCatalogue } from './refresh-guard-catalogue.js';

const repository: GuardRepository = { repository: 'fleet/rules', folder: 'guard', access: 'private' };
const other: GuardRepository = { repository: 'fleet/other', folder: 'guard', access: 'public' };
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const base = { name: 'base', rules: { tools: { deny: ['web'] } } };

function setup() {
  const snapshots = new Map<string, GuardSnapshot>();
  const contents = new Map([['one', 'base']]);
  let commit = 'commit-one';
  let files = [{ file: 'guard/base.yaml', blob: 'one' }];
  let failure: string | undefined;
  let failedRepository: string | undefined;
  const source: GuardSource = {
    latest: (_fleetId, entry) => Promise.resolve(failure === undefined || (failedRepository !== undefined && failedRepository !== entry.repository) ? ok(commit) : err(failure)),
    tree: (_fleetId, input) => Promise.resolve(failure === undefined || (failedRepository !== undefined && failedRepository !== input.repository.repository) ? ok(files) : err(failure)),
    read: (_fleetId, input) => {
      const content = contents.get(input.blob);
      return Promise.resolve(content === undefined ? err('file unavailable') : ok(content));
    },
  };
  const validation: GuardValidation = {
    read: (content) => content.trim() === 'base' ? ok(base) : content === 'wrong-name' ? ok({ name: 'other', rules: {} }) : err('invalid rules'),
  };
  const store = {
      read: (fleetId: FleetId, entry: GuardRepository) => Promise.resolve(snapshots.get(`${fleetId}/${entry.repository}/${entry.folder}`)),
      save: (fleetId: FleetId, snapshot: GuardSnapshot) => { snapshots.set(`${fleetId}/${snapshot.repository}/${snapshot.folder}`, snapshot); return Promise.resolve(); },
    };
  const read = createRefreshGuardCatalogue({ source, validation, snapshots: store });
  return {
    refresh: async (fleetId: FleetId, input: GuardConfiguration) => (await read(fleetId, input)).catalogue, stored: createReadGuardCatalogue(store), contents, snapshots,
    change: (next: { commit: string; files: typeof files }) => { commit = next.commit; files = next.files; },
    fail: (reason: string, onlyRepository?: string) => { failure = reason; failedRepository = onlyRepository; },
  };
}

const configuration = { version: 3, repositories: [{ ...repository, readCommit: 'commit-one' }], floor: ['base', 'missing'] };

describe('refreshing the guard catalogue', () => {
  it('answers exactly public metadata, retaining unavailable floor names and omitting rules', async () => {
    const { refresh } = setup();
    await expect(refresh(FLEET_ID, configuration)).resolves.toEqual({
      version: 3, repositories: [{ ...repository, readCommit: 'commit-one' }],
      sets: [{ name: 'base', repository: 'fleet/rules', commit: 'commit-one', file: 'guard/base.yaml', rulesCount: 1 }],
      errors: [], conflicts: [], floor: ['base', 'missing'],
    });
  });

  it('counts every list entry once and exposes the last complete repository read', async () => {
    const state = setup();
    state.snapshots.set(`${FLEET_ID}/fleet/rules/guard`, {
      repository: repository.repository, folder: repository.folder, commit: 'commit-one',
      files: [{ file: 'guard/base.yaml', blob: 'one', result: ok({ name: 'base', rules: {
        commands: { allow: [{ command: 'npm', args: ['run', 'test'] }], deny: [{ command: 'git', args: ['push'] }] },
        git: { deny: ['push', 'skip-hooks'] },
        writePaths: { allow: ['src/**'], deny: ['secrets/**'] },
        tools: { allow: ['shell'], deny: ['web', 'agent'] },
      } }) }],
    });
    const result = await state.refresh(FLEET_ID, configuration);
    expect(result.repositories).toEqual([{ ...repository, readCommit: 'commit-one' }]);
    expect(result.sets).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'commit-one', file: 'guard/base.yaml', rulesCount: 9 }]);
    state.fail('repository unavailable');
    expect((await state.refresh(FLEET_ID, configuration)).repositories).toEqual([{ ...repository, readCommit: 'commit-one' }]);
    expect((await state.refresh(OTHER, configuration)).repositories).toEqual([{ ...repository, readCommit: null }]);
  });

  it('keeps the last valid sets on a repository error, scoped to the fleet', async () => {
    const state = setup();
    await state.refresh(FLEET_ID, configuration);
    state.fail('repository unavailable');
    const result = await state.refresh(FLEET_ID, configuration);
    expect(result.sets).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'commit-one', file: 'guard/base.yaml', rulesCount: 1 }]);
    expect(result.errors).toEqual([{ repository: 'fleet/rules', reason: 'repository unavailable' }]);
    expect((await state.refresh(OTHER, configuration)).sets).toEqual([]);
  });

  it('updates other repositories when one repository is unavailable', async () => {
    const state = setup();
    const both = { ...configuration, repositories: [repository, other] };
    await state.refresh(FLEET_ID, both);
    state.change({ commit: 'commit-two', files: [{ file: 'guard/base.yaml', blob: 'one' }] });
    state.fail('repository unavailable', 'fleet/rules');
    const updated = await state.refresh(FLEET_ID, both);
    expect(updated.repositories.map(({ readCommit }) => readCommit)).toEqual(['commit-one', 'commit-two']);
    expect(updated.errors).toEqual([{ repository: 'fleet/rules', reason: 'repository unavailable' }]);
  });

  it('reads stored definitions and their exact commits while the source is unavailable', async () => {
    const state = setup();
    await state.refresh(FLEET_ID, configuration);
    state.fail('repository unavailable');
    const stored = await state.stored(FLEET_ID, configuration);
    expect(stored.isReadFailed).toBe(false);
    expect(stored.definitions).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'commit-one', file: 'guard/base.yaml', rules: { tools: { deny: ['web'] } } }]);
  });

  it('excludes nested files from a stored snapshot of an unchanged commit', async () => {
    const { refresh, snapshots } = setup();
    snapshots.set(`${FLEET_ID}/fleet/rules/guard`, {
      repository: repository.repository, folder: repository.folder, commit: 'commit-one',
      files: [
        { file: 'guard/base.yaml', blob: 'one', result: ok(base) },
        { file: 'guard/a/base.yaml', blob: 'nested-a', result: ok(base) },
        { file: 'guard/b/base.yaml', blob: 'nested-b', result: ok(base) },
      ],
    });
    expect((await refresh(FLEET_ID, configuration)).sets).toEqual([
      { name: 'base', repository: 'fleet/rules', commit: 'commit-one', file: 'guard/base.yaml', rulesCount: 1 },
    ]);
  });

  it('reuses unchanged commits and blobs without reading their content again', async () => {
    const state = setup();
    await state.refresh(FLEET_ID, configuration);
    state.contents.clear();
    expect((await state.refresh(FLEET_ID, configuration)).errors).toEqual([]);
    state.change({ commit: 'commit-two', files: [{ file: 'guard/base.yaml', blob: 'one' }] });
    expect((await state.refresh(FLEET_ID, configuration)).sets).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'commit-two', file: 'guard/base.yaml', rulesCount: 1 }]);
  });

  it('reads changed YAML blobs and removes deleted files', async () => {
    const state = setup();
    await state.refresh(FLEET_ID, configuration);
    state.contents.set('two', 'invalid');
    state.change({ commit: 'commit-two', files: [{ file: 'guard/base.yaml', blob: 'two' }] });
    const result = await state.refresh(FLEET_ID, configuration);
    expect(result.sets).toEqual([]);
    expect(result.errors).toEqual([{ repository: 'fleet/rules', file: 'guard/base.yaml', reason: 'invalid rules' }]);
    state.change({ commit: 'commit-three', files: [] });
    expect((await state.refresh(FLEET_ID, configuration)).errors).toEqual([]);
  });

  it('offers neither repository when a name conflicts', async () => {
    const state = setup();
    const result = await state.refresh(FLEET_ID, { ...configuration, repositories: [repository, other] });
    expect(result.sets).toEqual([]);
    expect(result.conflicts).toEqual([{ name: 'base', repositories: ['fleet/rules', 'fleet/other'] }]);
  });

  it('rejects a name different from the file name and ignores non-YAML files', async () => {
    const state = setup();
    state.contents.set('one', 'wrong-name');
    state.change({ commit: 'commit-two', files: [{ file: 'guard/base.yaml', blob: 'one' }, { file: 'guard/readme.md', blob: 'absent' }] });
    const result = await state.refresh(FLEET_ID, configuration);
    expect(result.sets).toEqual([]);
    expect(result.errors).toEqual([{ repository: 'fleet/rules', file: 'guard/base.yaml', reason: 'rule set name does not match file name' }]);
  });

  it('accepts exactly 64 KB and rejects one byte over before validation', async () => {
    const state = setup();
    state.contents.set('one', 'base');
    const atLimit = ' '.repeat(65532) + 'base';
    state.contents.set('large', atLimit);
    state.change({ commit: 'large', files: [{ file: 'guard/base.yaml', blob: 'large' }] });
    expect((await state.refresh(FLEET_ID, configuration)).sets).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'large', file: 'guard/base.yaml', rulesCount: 1 }]);
    state.contents.set('larger', atLimit + 'x');
    state.change({ commit: 'larger', files: [{ file: 'guard/base.yaml', blob: 'larger' }] });
    expect((await state.refresh(FLEET_ID, configuration)).errors).toEqual([{ repository: 'fleet/rules', file: 'guard/base.yaml', reason: 'rule set exceeds 64 KB' }]);
  });

  it('keeps the complete previous commit when a changed blob cannot be read and retries it', async () => {
    const state = setup();
    await state.refresh(FLEET_ID, configuration);
    state.change({ commit: 'commit-two', files: [{ file: 'guard/base.yaml', blob: 'two' }] });
    const failed = await state.refresh(FLEET_ID, configuration);
    expect(failed.sets).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'commit-one', file: 'guard/base.yaml', rulesCount: 1 }]);
    expect(failed.errors).toEqual([{ repository: 'fleet/rules', reason: 'file unavailable' }]);
    state.contents.set('two', 'base');
    expect((await state.refresh(FLEET_ID, configuration)).sets).toEqual([{ name: 'base', repository: 'fleet/rules', commit: 'commit-two', file: 'guard/base.yaml', rulesCount: 1 }]);
  });

  it('caches validation errors and stops exposing a removed repository', async () => {
    const state = setup();
    state.contents.set('one', 'invalid');
    await state.refresh(FLEET_ID, configuration);
    state.contents.clear();
    state.change({ commit: 'commit-two', files: [{ file: 'guard/base.yaml', blob: 'one' }] });
    expect((await state.refresh(FLEET_ID, configuration)).errors).toEqual([{ repository: 'fleet/rules', file: 'guard/base.yaml', reason: 'invalid rules' }]);
    expect(await state.refresh(FLEET_ID, { ...configuration, repositories: [] })).toEqual({ version: 3, repositories: [], sets: [], errors: [], conflicts: [], floor: ['base', 'missing'] });
  });

});
