import type { FleetId, PluginCallContext } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaRepositories } from '../src/adapters/prisma/repositories.js';
import { createManageRepositories } from '../src/core/repositories/manage-repositories.js';
import { createPluginDatabase } from '../src/testing/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const actor: PluginCallContext['actor'] = { kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9h4a' };
const context = { fleetId: FLEET, actor, requestId: '8c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', scopes: ['trierarch:repositories'] };
const clients: PrismaClient[] = [];
let databaseUrl: string;
function client(): PrismaClient {
  const db = createPrismaClient(databaseUrl);
  clients.push(db);
  return db;
}
beforeEach(async () => { databaseUrl = await createPluginDatabase(); });
afterEach(async () => { await Promise.all(clients.splice(0).map((db) => db.$disconnect())); });

describe('repository lists in Postgres', () => {
  it('persists a fleet list and its actor event across restart, isolated from another fleet', async () => {
    const manage = createManageRepositories(createPrismaRepositories(client()));
    await manage.change(context, { kind: 'add', name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 });
    const db = client();
    const restarted = createManageRepositories(createPrismaRepositories(db));
    await expect(restarted.list(context)).resolves.toEqual({ isOk: true, value: { version: 1, repositories: [{ name: 'main', url: 'https://example.com/a.git' }] } });
    await expect(restarted.list({ ...context, fleetId: OTHER })).resolves.toEqual({ isOk: true, value: { version: 0, repositories: [] } });
    const events = await db.$queryRaw<{ actor: unknown; request_id: string }[]>`SELECT actor, request_id FROM repository_events WHERE fleet_id = ${FLEET}`;
    expect(events).toEqual([{ actor, request_id: context.requestId }]);
  });

  it('forgets the list and its events when the fleet is deleted', async () => {
    const db = client();
    const manage = createManageRepositories(createPrismaRepositories(db));
    await manage.change(context, { kind: 'add', name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 });
    await createPrismaFleetForgetter(db).forget(FLEET);
    await expect(manage.list(context)).resolves.toEqual({ isOk: true, value: { version: 0, repositories: [] } });
    const events = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM repository_events WHERE fleet_id = ${FLEET}`;
    expect(events[0]?.count).toBe(0n);
  });

  it('rolls back the list if its event cannot be written', async () => {
    const db = client();
    await db.$executeRaw`INSERT INTO repository_events (fleet_id, version, actor, operation, name, request_id) VALUES (${FLEET}, 1, '{}'::jsonb, 'add', 'occupied', 'test')`;
    const manage = createManageRepositories(createPrismaRepositories(db));
    await expect(manage.change(context, { kind: 'add', name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 })).rejects.toThrow();
    await expect(manage.list(context)).resolves.toEqual({ isOk: true, value: { version: 0, repositories: [] } });
  });

  it('commits one competing first writer and one event', async () => {
    const first = createManageRepositories(createPrismaRepositories(client()));
    const second = createManageRepositories(createPrismaRepositories(client()));
    const results = await Promise.all([first.change(context, { kind: 'add', name: 'a', url: 'https://example.com/a.git', expectedVersion: 0 }), second.change(context, { kind: 'add', name: 'b', url: 'https://example.com/b.git', expectedVersion: 0 })]);
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    const events = await client().$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM repository_events WHERE fleet_id = ${FLEET}`;
    expect(events[0]?.count).toBe(1n);
  });
});
