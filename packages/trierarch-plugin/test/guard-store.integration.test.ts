import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaGuardStore } from '../src/adapters/prisma/guard-store.js';
import { createPluginDatabase } from '../src/testing/database.js';
import { err, ok } from '../src/core/shared/result.js';
import { createReadGuardCatalogue, createRefreshGuardCatalogue } from '../src/core/guard/refresh-guard-catalogue.js';

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

  it('keeps a failed first read across a restart and clears it after a good read', async () => {
    const first = store();
    let isAvailable = false;
    const refresh = createRefreshGuardCatalogue({
      snapshots: first,
      source: {
        latest: () => Promise.resolve(isAvailable ? ok('commit-one') : err('repository unavailable')),
        tree: () => Promise.resolve(ok([])),
        read: () => Promise.resolve(err('unexpected read')),
      },
      validation: { read: () => err('unexpected validation') },
    });
    const input = { version: 1, repositories: [repository], floor: [] };
    await refresh(FLEET, input);
    const restarted = store();
    const failure = await restarted.readFailure(FLEET, repository);
    expect(failure?.reason).toBe('repository unavailable');
    expect(failure?.at).toBeInstanceOf(Date);
    const read = createReadGuardCatalogue(restarted);
    expect((await read(FLEET, input)).catalogue).toMatchObject({
      repositories: [{ repository: 'fleet/rules', readCommit: null }],
      errors: [{ repository: 'fleet/rules', reason: 'repository unavailable' }],
    });
    expect((await read(OTHER, input)).catalogue.errors).toEqual([]);
    isAvailable = true;
    await refresh(FLEET, input);
    expect(await restarted.readFailure(FLEET, repository)).toBeUndefined();
    expect((await read(FLEET, input)).catalogue).toMatchObject({
      repositories: [{ repository: 'fleet/rules', readCommit: 'commit-one' }], errors: [],
    });
  });

  it('pins one rules resolution across competing passes, restarts and settings versions', async () => {
    const first = store();
    const second = store();
    const shipId: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
    const trierarchShipId: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
    const at = { shipId, settingsVersion: 1 };
    const base = { name: 'base', repository: 'fleet/rules', commit: 'a'.repeat(40), file: 'guard/base.yaml', floor: true, rules: {} };
    const resolutions = await Promise.all([first.pin(FLEET, { ...at, sets: [base] }), second.pin(FLEET, { ...at, sets: [] })]);
    expect(resolutions[0]).toEqual(resolutions[1]);
    const target = { ...at, trierarchShipId };
    const keys = await Promise.all([first.attempt(FLEET, { ...target, idempotencyKey: 'first' }), second.attempt(FLEET, { ...target, idempotencyKey: 'second' })]);
    expect(keys[0]).toBe(keys[1]);
    const restarted = store();
    expect((await restarted.readPinnedFor(FLEET, [at])).get(shipId)).toEqual(resolutions[0]);
    expect(await restarted.attempt(FLEET, { ...target, idempotencyKey: 'restarted' })).toBe(keys[0]);
    expect((await restarted.readPinnedFor(FLEET, [{ ...at, settingsVersion: 2 }])).get(shipId)).toBeUndefined();
    expect((await restarted.readPinnedFor(OTHER, [at])).get(shipId)).toBeUndefined();
    const client = clients[0];
    if (client === undefined) { throw new Error('missing test client'); }
    await createPrismaFleetForgetter(client).forget(FLEET);
    expect((await restarted.readPinnedFor(FLEET, [at])).has(shipId)).toBe(false);
    expect(await client.guardDeliveryAttempt.count({ where: { fleetId: FLEET } })).toBe(0);
  });

  it('forgets guard credentials and snapshots with the fleet', async () => {
    const first = store();
    await first.replace(FLEET, { expectedVersion: 0, configuration });
    await first.save(FLEET, snapshot);
    const client = clients[0];
    if (client === undefined) { throw new Error('missing test client'); }
    await createPrismaFleetForgetter(client).forget(FLEET);
    expect(await first.readConfiguration(FLEET)).toEqual({ version: 0, repositories: [], floor: [], secrets: [] });
    expect(await first.read(FLEET, repository)).toBeUndefined();
    expect(await client.guardSecret.count({ where: { fleetId: FLEET } })).toBe(0);
  });

  it('rolls back the version and token deletion when saving a token fails', async () => {
    const first = store();
    await first.replace(FLEET, { expectedVersion: 0, configuration });
    const client = clients[0];
    if (client === undefined) { throw new Error('missing test client'); }
    await client.$executeRawUnsafe("ALTER TABLE guard_secrets ADD CONSTRAINT test_token_refused CHECK (value <> 'refused')");
    await expect(first.replace(FLEET, { expectedVersion: 1, configuration: { ...configuration, version: 2, secrets: [{ name: 'fleet/rules', value: 'refused' }] } })).rejects.toThrow();
    expect(await first.readConfiguration(FLEET)).toEqual(configuration);
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
