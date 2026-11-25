import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { createGithubGuardSource } from './guard-source.js';

const repository = { repository: 'fleet/rules', folder: 'guard', access: 'private' } as const;
function setup(responses: readonly unknown[]) {
  const requests: { url: string; authorization: string | null }[] = [];
  let index = 0;
  const source = createGithubGuardSource({
    configurations: { readConfiguration: () => Promise.resolve({ version: 1, repositories: [repository], floor: [], secrets: [{ name: 'fleet/rules', value: 'test-token' }] }) },
    fetch: (input, init) => {
      requests.push({ url: input instanceof Request ? input.url : input.toString(), authorization: new Headers(init?.headers).get('authorization') });
      const response = responses[index++];
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(Response.json(response));
    },
  });
  return { source, requests };
}

describe('reading guard repositories through GitHub', () => {
  it('reads the default branch commit, the pinned tree and a blob using the private repository token', async () => {
    const { source, requests } = setup([[{ sha: 'commit-one' }],
      { truncated: false, tree: [{ path: 'guard', type: 'tree', sha: 'guard-tree' }] },
      { truncated: false, tree: [{ path: 'base.yaml', type: 'blob', sha: 'blob-one' }] },
      { encoding: 'base64', content: Buffer.from('name: base\nrules: {}').toString('base64') }]);
    expect(await source.latest(FLEET_ID, repository)).toEqual({ isOk: true, value: 'commit-one' });
    expect(await source.tree(FLEET_ID, { repository, commit: 'commit-one' })).toEqual({ isOk: true, value: [{ file: 'guard/base.yaml', blob: 'blob-one' }] });
    expect(await source.read(FLEET_ID, { repository, commit: 'commit-one', file: 'guard/base.yaml', blob: 'blob-one' })).toEqual({ isOk: true, value: 'name: base\nrules: {}' });
    expect(requests).toEqual([
      { url: 'https://api.github.com/repos/fleet/rules/commits?per_page=1', authorization: 'Bearer test-token' },
      { url: 'https://api.github.com/repos/fleet/rules/git/trees/commit-one', authorization: 'Bearer test-token' },
      { url: 'https://api.github.com/repos/fleet/rules/git/trees/guard-tree', authorization: 'Bearer test-token' },
      { url: 'https://api.github.com/repos/fleet/rules/git/blobs/blob-one', authorization: 'Bearer test-token' },
    ]);
  });

  it('offers only YAML files directly in the configured folder', async () => {
    const { source, requests } = setup([
      { truncated: false, tree: [
        { path: 'policies', type: 'tree', sha: 'policies-tree' },
        { path: 'base.yaml', type: 'blob', sha: 'outside' },
      ] },
      { truncated: false, tree: [{ path: 'rules', type: 'tree', sha: 'rules-tree' }] },
      { truncated: false, tree: [
        { path: 'a', type: 'tree', sha: 'a-tree' },
        { path: 'b', type: 'tree', sha: 'b-tree' },
        { path: 'base.yaml', type: 'blob', sha: 'base-blob' },
        { path: 'readme.md', type: 'blob', sha: 'readme' },
      ] },
      { truncated: false, tree: [{ path: 'base.yaml', type: 'blob', sha: 'nested-a' }] },
      { truncated: false, tree: [{ path: 'base.yaml', type: 'blob', sha: 'nested-b' }] },
    ]);
    await expect(source.tree(FLEET_ID, { repository: { ...repository, folder: 'policies/rules' }, commit: 'commit' }))
      .resolves.toEqual({ isOk: true, value: [{ file: 'policies/rules/base.yaml', blob: 'base-blob' }] });
    expect(requests.map(({ url }) => url)).toEqual([
      'https://api.github.com/repos/fleet/rules/git/trees/commit',
      'https://api.github.com/repos/fleet/rules/git/trees/policies-tree',
      'https://api.github.com/repos/fleet/rules/git/trees/rules-tree',
    ]);
  });

  it('offers only direct YAML files when the configured folder is the repository root', async () => {
    const { source } = setup([{ truncated: false, tree: [
      { path: 'base.yaml', type: 'blob', sha: 'root-blob' },
      { path: 'nested.yaml', type: 'tree', sha: 'nested-tree' },
    ] }]);
    await expect(source.tree(FLEET_ID, { repository: { ...repository, folder: '' }, commit: 'commit' }))
      .resolves.toEqual({ isOk: true, value: [{ file: 'base.yaml', blob: 'root-blob' }] });
  });

  it('sends no authorization for a public repository', async () => {
    const { source, requests } = setup([[{ sha: 'commit' }]]);
    await source.latest(FLEET_ID, { ...repository, access: 'public' });
    expect(requests[0]?.authorization).toBeNull();
  });

  it.each([new Error('test-token'), { message: 'test-token' }, [], [{ sha: 4 }]])('refuses an unreadable head with a safe reason', async (response) => {
    expect(await setup([response]).source.latest(FLEET_ID, repository)).toEqual({ isOk: false, error: 'repository unavailable' });
  });

  it('refuses a truncated tree instead of dropping known rule sets', async () => {
    const { source } = setup([{ truncated: true, tree: [] }]);
    expect(await source.tree(FLEET_ID, { repository, commit: 'commit' })).toEqual({ isOk: false, error: 'repository tree unavailable' });
  });
});
