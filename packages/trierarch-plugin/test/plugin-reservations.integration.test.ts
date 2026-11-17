import type { PluginCallContext } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPluginReservations } from '../src/adapters/prisma/plugin-reservations.js';
import { createPluginDatabase } from '../src/testing/database.js';

const context: PluginCallContext = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv', pluginShipId: 'shp_01m3tbfspe96yf1rnr4ank9h4a', requestId: '8c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', actor: { kind: 'installation' }, scopes: [], procedure: 'repositories.list', input: {}, expiresAt: '2099-01-01T00:00:00.000Z' };
let databaseUrl: string;
const clients: PrismaClient[] = [];
function client(): PrismaClient { const db = createPrismaClient(databaseUrl); clients.push(db); return db; }
beforeEach(async () => { databaseUrl = await createPluginDatabase(); });
afterEach(async () => { await Promise.all(clients.splice(0).map((db) => db.$disconnect())); });

describe('plugin dispatch reservations', () => {
  it('admits one concurrent dispatch and refuses reuse after restart', async () => {
    const first = createPrismaPluginReservations(client());
    const second = createPrismaPluginReservations(client());
    const results = await Promise.all([first.reserve(context), second.reserve({ ...context, input: { changed: true } })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(createPrismaPluginReservations(client()).reserve(context)).resolves.toBe(false);
  });
});
