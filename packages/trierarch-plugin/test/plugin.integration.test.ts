import type { ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { newKey } from '../../core/test/support/keys.js';
import { unwrap } from '../../core/test/support/result.js';
import { createTrierarchPluginApp, type TrierarchPluginApp } from '../src/app.js';
import { connectPlugin, mutate, query, signIn } from './support/connection.js';
import { createPluginDatabase } from './support/database.js';

// The trierarch plugin against a real fleet: it starts not connected, with no
// secret anywhere; the operator connects it as its ship (fleet:read,
// fleet:manage, crew:assign), keeps the crew token in its own database and is
// connected again after a restart. Machines join through it.

let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let pluginDatabaseUrl: string;
let useCases: ReturnType<typeof createUseCases>;
let argo: ReturnType<typeof operatorCaller>;
let shipId: ShipId;
let secret: string;
let cookie: string;
const apps: TrierarchPluginApp[] = [];

beforeEach(async () => {
  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  useCases = createUseCases({ prisma: fleetDatabase });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const commissioned = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'trierarch-plugin', fleetScopes: ['fleet:read', 'fleet:manage', 'crew:assign'] }),
  );
  shipId = commissioned.shipId;
  secret = secretOf(commissioned.secret);
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn(fleetUrl);
  pluginDatabaseUrl = await createPluginDatabase();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await fleet.close();
  await fleetDatabase.$disconnect();
});

/** A trierarch plugin process on the test's database, serving on a free port; with an installation token, a fleet is served once switched on. */
async function started(installationToken?: string): Promise<{ app: TrierarchPluginApp; address: string }> {
  const app = createTrierarchPluginApp({ databaseUrl: pluginDatabaseUrl, fleetUrl, logger: false, ...(installationToken === undefined ? {} : { installationToken }) });
  apps.push(app);
  await app.restoreConnections();
  return { app, address: await app.server.listen({ host: '127.0.0.1', port: 0 }) };
}

/** A trierarch plugin process, connected to the fleet. */
async function connected(): Promise<string> {
  const { address } = await started();
  const answer = await connectPlugin(address, { cookie, shipId, secret });
  expect(answer.status, await answer.clone().text()).toBe(200);
  return address;
}

const statusSchema = z.object({
  result: z.object({ data: z.object({ state: z.string(), ship: z.object({ shipId: z.string(), name: z.string() }).nullable(), lastShipId: z.string().nullable() }) }),
});

async function status(address: string) {
  return statusSchema.parse(await (await query(address, { procedure: 'connection.status', cookie })).json()).result.data;
}

const joinedSchema = z.object({
  result: z.object({ data: z.object({ shipId: z.string(), name: z.string(), prompt: z.string(), crewLines: z.array(z.object({ harness: z.string(), line: z.string() })), secret: z.string(), setupLine: z.string() }) }),
});

describe('a trierarch plugin process that was never connected', () => {
  it('starts not connected, and its health and version say so', async () => {
    const { address } = await started();

    await expect(status(address)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
    const health = await fetch(`${address}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok', connectedFleets: 0, installation: 'open' });
    const version = z.object({ trierarchPlugin: z.string(), migration: z.string(), connectedFleets: z.number() }).parse(await (await fetch(`${address}/api/version`)).json());
    expect(version.migration).toMatch(/^\d{14}_init$/);
    expect(version.trierarchPlugin).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('refuses a join and the machines until it is connected', async () => {
    const { address } = await started();

    await expect(mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } }).then((response) => response.status)).resolves.toBe(412);
    await expect(query(address, { procedure: 'machines.list', cookie }).then((response) => response.status)).resolves.toBe(412);
  });
});

describe('connecting the trierarch plugin', () => {
  it('registers its ship with the secret, as a server in the aeolus-trierarch-plugin harness, and is connected as it', async () => {
    const address = await connected();

    await expect(status(address)).resolves.toEqual({ state: 'connected', ship: { shipId, name: 'trierarch-plugin' }, lastShipId: shipId });
    await expect(fleetDatabase.lease.findFirstOrThrow({ where: { shipId, endedAt: null } })).resolves.toMatchObject({ location: 'SERVER', harness: 'aeolus-trierarch-plugin' });
  });

  it('is refused for a ship without crew:assign', async () => {
    const manager = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'manager', type: 'trierarch-plugin', fleetScopes: ['fleet:read', 'fleet:manage'] }));
    const { address } = await started();

    const refused = await connectPlugin(address, { cookie, shipId: manager.shipId, secret: secretOf(manager.secret) });

    expect(refused.status).toBe(400);
    await expect(status(address)).resolves.toMatchObject({ state: 'not-connected' });
  });

  it('is connected again after a restart with the kept crew token, without a new lease', async () => {
    await connected();
    await apps.splice(0)[0]?.close();

    const { address } = await started();

    await expect(status(address)).resolves.toMatchObject({ state: 'connected' });
    await expect(fleetDatabase.lease.count({ where: { shipId } })).resolves.toBe(1);
  });
});

describe('a machine joining', () => {
  it('commissions a ship of type trierarch with exactly send, receive and crew:run, and answers its starting prompt and setup line', async () => {
    const address = await connected();

    const answer = await mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } });

    expect(answer.status, await answer.clone().text()).toBe(200);
    const joined = joinedSchema.parse(await answer.json()).result.data;
    const ship = await fleetDatabase.ship.findUniqueOrThrow({ where: { id: joined.shipId } });
    expect({ name: ship.name, type: ship.type, scopes: [...ship.scopes].sort() }).toEqual({ name: 'mac-studio', type: 'trierarch', scopes: ['crew:run', 'messages:receive', 'messages:send'] });
    expect(joined.prompt).toContain(joined.secret);
    expect(joined.crewLines.map((line) => line.harness)).toContain('claude-code');
    expect(joined.setupLine).toBe(`npx @aeolus-fleet/trierarch init --fleet-url ${fleetUrl} --ship-id ${joined.shipId} --secret ${joined.secret}`);
  });

  it('is refused for a name an active ship holds', async () => {
    const address = await connected();

    await expect(mutate(address, { procedure: 'machines.join', cookie, body: { name: 'trierarch-plugin' } }).then((response) => response.status)).resolves.toBe(409);
  });

  it('is refused without a console session of the fleet', async () => {
    const address = await connected();

    await expect(mutate(address, { procedure: 'machines.join', cookie: 'aeolus_session=forged', body: { name: 'mac-studio' } }).then((response) => response.status)).resolves.toBe(401);
  });
});

describe('the installation (decision 0021)', () => {
  const TOKEN = 'an-installation-token-of-at-least-32-characters';

  function installation(address: string, request: { procedure: string; body: unknown }): Promise<Response> {
    const headers = { 'content-type': 'application/json', 'x-aeolus-installation-token': TOKEN };
    return request.procedure === 'installation.get'
      ? fetch(`${address}/trpc/installation.get?input=${encodeURIComponent(JSON.stringify(request.body))}`, { headers })
      : fetch(`${address}/trpc/${request.procedure}`, { method: 'POST', headers, body: JSON.stringify(request.body) });
  }

  it('serves a fleet only once switched on: until then connect and join are refused', async () => {
    const { address } = await started(TOKEN);
    const fleetId = argo.fleetId;

    await expect(connectPlugin(address, { cookie, shipId, secret }).then((response) => response.status)).resolves.toBe(403);
    expect((await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } })).status).toBe(200);
    expect((await connectPlugin(address, { cookie, shipId, secret })).status).toBe(200);
    expect((await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: false } })).status).toBe(200);

    await expect(mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } }).then((response) => response.status)).resolves.toBe(403);
    await expect(installation(address, { procedure: 'installation.get', body: { fleetId } }).then((response) => response.json())).resolves.toEqual({ result: { data: { enabled: false, connected: true } } });
  });

  it("forgets the fleet's connection and switch when the fleet is deleted", async () => {
    const { address } = await started(TOKEN);
    const fleetId = argo.fleetId;
    await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } });
    expect((await connectPlugin(address, { cookie, shipId, secret })).status).toBe(200);

    expect((await installation(address, { procedure: 'installation.delete', body: { requestId: newKey(), fleetId } })).status).toBe(200);

    await expect(installation(address, { procedure: 'installation.get', body: { fleetId } }).then((response) => response.json())).resolves.toEqual({ result: { data: { enabled: false, connected: false } } });
  });
});
