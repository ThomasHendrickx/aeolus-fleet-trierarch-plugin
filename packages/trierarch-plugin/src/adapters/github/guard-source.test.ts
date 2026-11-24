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
      requests.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
      const response = responses[index++];
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(Response.json(response));
    },
  });
  return { source, requests };
}

describe('reading guard repositories through GitHub', () => {
  it('reads the default branch commit, the pinned tree and a blob using the private repository token', async () => {
    const { source, requests } = setup([[{ sha: 'commit-one' }], { truncated: false, tree: [
      { path: 'guard/base.yaml', type: 'blob', sha: 'blob-one' }, { path: 'other/outside.yaml', type: 'blob', sha: 'outside' }, { path: 'guard/readme.md', type: 'blob', sha: 'readme' },
    ] }, { encoding: 'base64', content: Buffer.from('name: base\nrules: {}').toString('base64') }]);
    expect(await source.latest(FLEET_ID, repository)).toEqual({ isOk: true, value: 'commit-one' });
    expect(await source.tree(FLEET_ID, { repository, commit: 'commit-one' })).toEqual({ isOk: true, value: [{ file: 'guard/base.yaml', blob: 'blob-one' }] });
    expect(await source.read(FLEET_ID, { repository, commit: 'commit-one', file: 'guard/base.yaml', blob: 'blob-one' })).toEqual({ isOk: true, value: 'name: base\nrules: {}' });
    expect(requests).toEqual([
      { url: 'https://api.github.com/repos/fleet/rules/commits?per_page=1', authorization: 'Bearer test-token' },
      { url: 'https://api.github.com/repos/fleet/rules/git/trees/commit-one?recursive=1', authorization: 'Bearer test-token' },
      { url: 'https://api.github.com/repos/fleet/rules/git/blobs/blob-one', authorization: 'Bearer test-token' },
    ]);
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
