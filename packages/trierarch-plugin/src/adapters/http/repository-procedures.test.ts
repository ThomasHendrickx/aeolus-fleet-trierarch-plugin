import type { PluginCallContext } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createRepositoryProcedures } from './repository-procedures.js';
import { createManageRepositories, type RepositoryStore } from '../../core/repositories/manage-repositories.js';

const context: PluginCallContext = {
  fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv', pluginShipId: 'shp_01m3tbfspe96yf1rnr4ank9h4a',
  requestId: '8c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', actor: { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9h4b' },
  scopes: ['trierarch:repositories'], procedure: 'repositories.list', input: {}, expiresAt: '2026-11-18T12:00:00.000Z',
};
function procedures() {
  const store: RepositoryStore = { read: () => Promise.resolve({ version: 0, repositories: [] }), save: () => Promise.resolve(true) };
  return createRepositoryProcedures(createManageRepositories(store));
}

describe('repository procedures', () => {
  it('exposes only list, add and remove', () => {
    expect(Object.keys(procedures()).sort()).toEqual(['repositories.add', 'repositories.list', 'repositories.remove']);
  });
  it('allows a scoped agent to read', async () => {
    await expect(procedures()['repositories.list'](context)).resolves.toEqual({ result: { data: { version: 0, repositories: [] } } });
  });
  it('refuses an account without the repository scope', async () => {
    await expect(procedures()['repositories.list']({ ...context, actor: { kind: 'account', accountId: 'acc_test', throughShipId: null }, scopes: [] })).resolves.toEqual({ error: { data: { code: 'FORBIDDEN' } } });
  });
  it('refuses forged context in operation input', async () => {
    await expect(procedures()['repositories.list']({ ...context, input: { scopes: ['trierarch:repositories'] } })).resolves.toEqual({ error: { data: { code: 'BAD_REQUEST' } } });
  });
});
