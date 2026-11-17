import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createTrierarchPluginApp, type TrierarchPluginApp } from '../src/app.js';
import { createPluginDatabase } from '../src/testing/database.js';

const fleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const pluginShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const secret = 'the-internal-test-secret-is-long-enough';
const now = new Date('2026-11-18T12:00:00.000Z');
let app: TrierarchPluginApp;
let db: PrismaClient;
beforeEach(async () => {
  const databaseUrl = await createPluginDatabase();
  db = createPrismaClient(databaseUrl);
  await db.connection.create({ data: { fleetId, shipId: pluginShipId, shipName: 'plugin', crewToken: 'test-token', crewedAt: now } });
  app = createTrierarchPluginApp({ databaseUrl, fleetUrl: 'http://127.0.0.1:1', logger: false, clock: { now: () => now }, pluginSecrets: [secret] });
});
afterEach(async () => { await app.close(); await db.$disconnect(); });

function context(requestId: string, { procedure, input }: { procedure: string; input: unknown }) {
  return { fleetId, pluginShipId, requestId, actor: { kind: 'account', accountId: 'acc_test', throughShipId: null }, scopes: ['trierarch:repositories'], procedure, input, expiresAt: '2026-11-18T12:00:20.000Z' };
}

describe('repository actor calls over the internal listener', () => {
  it('adds and reads as the verified account and preserves its identity', async () => {
    const added = await app.pluginServer.inject({ method: 'POST', url: '/dispatch', headers: { 'aeolus-plugin-secret': secret }, payload: context('8c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', { procedure: 'repositories.add', input: { name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 } }) });
    expect(added.json()).toEqual({ result: { data: { version: 1, repositories: [{ name: 'main', url: 'https://example.com/a.git' }] } } });
    const listed = await app.pluginServer.inject({ method: 'POST', url: '/dispatch', headers: { 'aeolus-plugin-secret': secret }, payload: context('2c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', { procedure: 'repositories.list', input: {} }) });
    expect(listed.json()).toEqual(added.json());
    const events = await db.$queryRaw<{ actor: unknown }[]>`SELECT actor FROM repository_events WHERE fleet_id = ${fleetId}`;
    expect(events).toEqual([{ actor: { kind: 'account', accountId: 'acc_test', throughShipId: null } }]);
  });
  it('refuses the shared secret on the public listener', async () => {
    const response = await app.server.inject({ method: 'POST', url: '/trpc/connection.status', headers: { 'aeolus-plugin-secret': secret }, payload: {} });
    expect(response.statusCode).toBe(401);
  });
});
