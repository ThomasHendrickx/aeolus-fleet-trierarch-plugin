import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { createManageRepositories, type RepositoryStore } from './manage-repositories.js';

function memoryStore(): RepositoryStore {
  let current = { version: 0, repositories: [] as { name: string; url: string }[] };
  const events: unknown[] = [];
  return {
    events,
    read: async () => current,
    save: async (_fleetId, expectedVersion, next, event) => {
      if (current.version !== expectedVersion) return false;
      current = { version: next.version, repositories: [...next.repositories] };
      events.push(event);
      return true;
    },
  };
}

const actor = { kind: 'ship' as const, shipId: 'shp_01m3tbfspe96yf1rnr4ank9h4a' as const };
const request = { fleetId: FLEET_ID, actor, requestId: '8c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', scopes: ['trierarch:repositories'] };

describe('repository management', () => {
  it('requires the repository scope to read and write', async () => {
    const manage = createManageRepositories(memoryStore());
    expect((await manage.list({ ...request, scopes: [] })).isOk).toBe(false);
    expect((await manage.change({ ...request, scopes: [] }, { kind: 'add', name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 })).isOk).toBe(false);
  });

  it('records the verified actor for a change but not a no-op', async () => {
    const store = memoryStore();
    const manage = createManageRepositories(store);
    const change = { kind: 'add' as const, name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 };
    expect((await manage.change(request, change)).isOk).toBe(true);
    expect((await manage.change(request, { ...change, expectedVersion: 1 })).isOk).toBe(true);
    expect(store.events).toEqual([{ actor, operation: 'add', name: 'main', version: 1, requestId: request.requestId }]);
  });

  it('allows only one competing writer from a version', async () => {
    const manage = createManageRepositories(memoryStore());
    const results = await Promise.all(['a', 'b'].map((name) => manage.change(request, { kind: 'add', name, url: `https://example.com/${name}.git`, expectedVersion: 0 })));
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
  });
});
