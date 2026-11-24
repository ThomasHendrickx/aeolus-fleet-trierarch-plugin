import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaGuardStore } from '../src/adapters/prisma/guard-store.js';
import { createPluginDatabase } from '../src/testing/database.js';
import { ok } from '../src/core/shared/result.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const repository = { repository: 'fleet/rules', folder: 'guard', access: 'private' } as const;
const configuration = { version: 1, repositories: [repository], floor: ['base'], secrets: [{ name: 'fleet/rules', value: 'test-token' }] };
const snapshot = { repository: 'fleet/rules', folder: 'guard', commit: 'commit-one', files: [{ file: 'guard/base.yaml', blob: 'blob-one', result: ok({ name: 'base', rules: {} }) }] };
let databaseUrl: string;
const clients: PrismaClient[] = [];
function store() {
  const client = createPrismaClient(databaseUrl);
  clients.push(client);
  return createPrismaGuardStore(client);
}
beforeEach(async () => { databaseUrl = await createPluginDatabase(); });
afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.$disconnect())); });

describe('guard storage in Postgres', () => {
  it('keeps configuration, private tokens and complete snapshots across a restart and apart by fleet and folder', async () => {
    const first = store();
    expect(await first.replace(FLEET, { expectedVersion: 0, configuration })).toBe('replaced');
    await first.save(FLEET, snapshot);
    const restarted = store();
    expect(await restarted.readConfiguration(FLEET)).toEqual(configuration);
    expect(await restarted.readConfiguration(OTHER)).toEqual({ version: 0, repositories: [], floor: [], secrets: [] });
    expect(await restarted.read(FLEET, repository)).toEqual(snapshot);
    expect(await restarted.read(OTHER, repository)).toBeUndefined();
    expect(await restarted.read(FLEET, { ...repository, folder: 'other' })).toBeUndefined();
  });

  it.each([0, 1])('commits only one concurrent replacement at expected version %i', async (expectedVersion) => {
    const first = store();
    if (expectedVersion === 1) { await first.replace(FLEET, { expectedVersion: 0, configuration }); }
    const second = store();
    const outcomes = await Promise.all([first, second].map((entry) => entry.replace(FLEET, { expectedVersion, configuration: { ...configuration, version: expectedVersion + 1 } })));
    expect(outcomes.sort()).toEqual(['conflict', 'replaced']);
    expect((await first.readConfiguration(FLEET)).version).toBe(expectedVersion + 1);
  });
});
