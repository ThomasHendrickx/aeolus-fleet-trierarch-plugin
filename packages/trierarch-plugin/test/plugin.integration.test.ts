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
import { createRestFleet } from '../../trierarch/src/adapters/rest-fleet.js';
import { EMPTY_STATE } from '../../trierarch/src/core/entry.js';
import { createReportSelf } from '../../trierarch/src/core/report-self.js';
import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { runningVersion } from '../src/adapters/http/version.js';
import { machineOutputSchema } from '../src/adapters/trpc/router.js';
import { createTrierarchPluginApp, type TrierarchPluginApp } from '../src/app.js';
import { connectPlugin, mutate, query, signIn } from './support/connection.js';
import { createPluginDatabase } from './support/database.js';

// The trierarch plugin against a real fleet: it starts not connected, with no
// secret anywhere; the operator connects it as its ship (fleet:read,
// fleet:manage, crew:assign, labels:define, labels:assign), keeps the crew token in its own database and is
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
    await useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: 'trierarch-plugin',
      type: 'trierarch-plugin',
      fleetScopes: ['fleet:read', 'fleet:manage', 'crew:assign', 'labels:define', 'labels:assign'],
    }),
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
  it('starts not connected, its health saying only up and its version only the version it runs', async () => {
    const { address } = await started();

    await expect(status(address)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
    const health = await fetch(`${address}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
    const version = z.record(z.string(), z.string()).parse(await (await fetch(`${address}/api/version`)).json());
    expect(Object.keys(version)).toEqual(['trierarchPlugin']);
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

describe('a joined machine reporting', () => {
  it("reaches the trierarch plugin: the machines list shows its trierarch's report and details", async () => {
    const address = await connected();
    const joined = joinedSchema.parse(await (await mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } })).json()).result.data;
    const machineShipId = z.templateLiteral(['shp_', z.string()]).parse(joined.shipId);
    // The machine's trierarch, as init and run make it: registered with the secret the join answered, then reporting as its own ship.
    const { crewToken } = await createRestFleet({ fleetUrl, crewToken: '' }).registerSelf({ shipId: machineShipId, secret: joined.secret });
    const configuration = {
      caps: { ships: 6, running: 3 },
      repositories: { 'aeolus-fleet': { path: '/home/thomas/Projects/aeolus-fleet' } },
      folders: {},
      harnesses: { 'claude-code': { flags: ['--remote-control'], options: {} } },
    };
    const reportSelf = createReportSelf({
      fleet: createRestFleet({ fleetUrl, crewToken }),
      processes: { list: () => Promise.resolve([]), stop: () => Promise.resolve() },
      // Its harness trusts its repository, as init makes it (#381).
      trust: { trusted: () => Promise.resolve({ 'claude-code': { repositories: ['aeolus-fleet'], folders: [] } }) },
      state: { load: () => Promise.resolve(EMPTY_STATE), save: () => Promise.resolve() },
      setup: { configuration, version: '0.19.0', adapterFlags: {}, riskyFlags: {} },
    });

    await reportSelf();

    const listed = z.object({ result: z.object({ data: z.array(machineOutputSchema) }) }).parse(await (await query(address, { procedure: 'machines.list', cookie })).json()).result.data;
    // When it was last seen and reported is the fleet's clock: present, not compared.
    expect(listed.map((machine) => ({ ...machine, lastSeenAt: machine.lastSeenAt !== null, report: machine.report && { ...machine.report, reportedAt: null } }))).toEqual([
      {
        shipId: joined.shipId,
        name: 'mac-studio',
        status: 'crewed',
        lastSeenAt: true,
        isSilent: false,
        report: { state: 'idle', note: '0 of 6 running', reportedAt: null },
        details: {
          harnesses: [{ harness: 'claude-code', options: { type: 'object', properties: {}, additionalProperties: false }, flags: ['--remote-control'], riskyFlags: [] }],
          workspaces: { repositories: ['aeolus-fleet'], folders: [] },
          caps: { ships: 6, running: 3 },
          kept: [],
          orphans: [],
          version: '0.19.0',
        },
      },
    ]);
  });
});

describe('assignment against a real fleet', () => {
  it('two trierarch plugin passes race for one request, and exactly one assignment is stored', async () => {
    const address = await connected();
    const joined = joinedSchema.parse(await (await mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } })).json()).result.data;
    const machineShipId = z.templateLiteral(['shp_', z.string()]).parse(joined.shipId);
    const { crewToken } = await createRestFleet({ fleetUrl, crewToken: '' }).registerSelf({ shipId: machineShipId, secret: joined.secret });
    await createReportSelf({
      fleet: createRestFleet({ fleetUrl, crewToken }),
      processes: { list: () => Promise.resolve([]), stop: () => Promise.resolve() },
      // Its harness trusts its repository, as init makes it (#381).
      trust: { trusted: () => Promise.resolve({ 'claude-code': { repositories: ['aeolus-fleet'], folders: [] } }) },
      state: { load: () => Promise.resolve(EMPTY_STATE), save: () => Promise.resolve() },
      setup: {
        configuration: { caps: { ships: 4, running: 2 }, repositories: { 'aeolus-fleet': { path: '/srv/aeolus-fleet' } }, folders: {}, harnesses: { 'claude-code': { flags: [], options: {} } } },
        version: '0.19.0',
        adapterFlags: {},
        riskyFlags: {},
      },
    })();
    const scout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'implementer' }));
    unwrap(await useCases.requestCrew(argo, { shipId: scout.shipId, settings: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} } }));
    // A second process on the same database, crewing the same ship with the kept crew token.
    const second = await started();

    const [first, other] = await Promise.all([apps[0]?.assignOnce() ?? Promise.resolve([]), second.app.assignOnce()]);

    const assigned = [...first, ...other].reduce((sum, { outcome }) => sum + outcome.assigned, 0);
    expect(assigned).toBe(1);
    await expect(fleetDatabase.crewRequest.findUniqueOrThrow({ where: { shipId: scout.shipId } })).resolves.toMatchObject({ assignedTo: joined.shipId, reason: null });
    await expect(fleetDatabase.event.count({ where: { type: 'CrewAssigned', shipId: scout.shipId } })).resolves.toBe(1);
  });

  it('writes the reason on a request no trierarch can take', async () => {
    await connected();
    const scout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'implementer' }));
    unwrap(await useCases.requestCrew(argo, { shipId: scout.shipId, settings: { harness: 'codex', workspace: { kind: 'folder', name: 'notes' }, options: {} } }));

    await apps[0]?.assignOnce();

    await expect(fleetDatabase.crewRequest.findUniqueOrThrow({ where: { shipId: scout.shipId } })).resolves.toMatchObject({ assignedTo: null, reason: 'no trierarch reports yet' });
  });
});

describe('machine labels against a real fleet (#102)', () => {
  it('labels a machine from the machine its trierarch reports, and places a request only on a machine that carries its labels', async () => {
    const address = await connected();
    const joined = joinedSchema.parse(await (await mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } })).json()).result.data;
    const machineShipId = z.templateLiteral(['shp_', z.string()]).parse(joined.shipId);
    const { crewToken } = await createRestFleet({ fleetUrl, crewToken: '' }).registerSelf({ shipId: machineShipId, secret: joined.secret });
    await createReportSelf({
      fleet: createRestFleet({ fleetUrl, crewToken }),
      processes: { list: () => Promise.resolve([]), stop: () => Promise.resolve() },
      // Its harness trusts its repository, as init makes it (#381).
      trust: { trusted: () => Promise.resolve({ 'claude-code': { repositories: ['aeolus-fleet'], folders: [] } }) },
      state: { load: () => Promise.resolve(EMPTY_STATE), save: () => Promise.resolve() },
      setup: {
        configuration: { caps: { ships: 4, running: 2 }, repositories: { 'aeolus-fleet': { path: '/srv/aeolus-fleet' } }, folders: {}, harnesses: { 'claude-code': { flags: [], options: {} } } },
        version: '0.20.0',
        adapterFlags: {},
        riskyFlags: {},
        machine: { os: 'macos', arch: 'arm64' },
      },
    })();

    await apps[0]?.assignOnce();

    const labels = await useCases.listLabels(argo);
    expect(labels.map((label) => ({ key: label.key, values: label.values.map((value) => value.value), owner: label.owner.name }))).toEqual([
      { key: 'arch', values: ['arm64', 'amd64'], owner: 'trierarch-plugin' },
      { key: 'os', values: ['macos', 'linux', 'windows'], owner: 'trierarch-plugin' },
    ]);
    const machine = (await useCases.listFleet(argo)).find((ship) => ship.id === machineShipId);
    expect(machine?.labels.map((label) => `${label.key}=${label.value}`)).toEqual(['arch=arm64', 'os=macos']);

    const valueOf = async (key: string, value: string) => unwrap(await useCases.findLabelValue(argo, { key, value })).valueId;
    const settings = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} } as const;
    const scout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'implementer' }));
    unwrap(await useCases.requestCrew(argo, { shipId: scout.shipId, settings: { ...settings, machineLabels: [await valueOf('os', 'linux')] } }));
    const lookout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'implementer' }));
    unwrap(await useCases.requestCrew(argo, { shipId: lookout.shipId, settings: { ...settings, machineLabels: [await valueOf('os', 'macos'), await valueOf('arch', 'arm64')] } }));

    await apps[0]?.assignOnce();

    await expect(fleetDatabase.crewRequest.findUniqueOrThrow({ where: { shipId: scout.shipId } })).resolves.toMatchObject({ assignedTo: null, reason: 'no machine matches its labels' });
    await expect(fleetDatabase.crewRequest.findUniqueOrThrow({ where: { shipId: lookout.shipId } })).resolves.toMatchObject({ assignedTo: joined.shipId, reason: null });
  });
});

describe('checking crew settings before a request (#245)', () => {
  const checkSchema = z.object({ result: z.object({ data: z.object({ kind: z.string(), field: z.string().optional() }) }) });

  it("answers from the fleet's trierarchs: settings a reporting trierarch offers fit, a harness none offers is refused by field", async () => {
    const address = await connected();
    const joined = joinedSchema.parse(await (await mutate(address, { procedure: 'machines.join', cookie, body: { name: 'mac-studio' } })).json()).result.data;
    const machineShipId = z.templateLiteral(['shp_', z.string()]).parse(joined.shipId);
    const { crewToken } = await createRestFleet({ fleetUrl, crewToken: '' }).registerSelf({ shipId: machineShipId, secret: joined.secret });
    await createReportSelf({
      fleet: createRestFleet({ fleetUrl, crewToken }),
      processes: { list: () => Promise.resolve([]), stop: () => Promise.resolve() },
      // Its harness trusts its repository, as init makes it (#381).
      trust: { trusted: () => Promise.resolve({ 'claude-code': { repositories: ['aeolus-fleet'], folders: [] } }) },
      state: { load: () => Promise.resolve(EMPTY_STATE), save: () => Promise.resolve() },
      setup: {
        configuration: { caps: { ships: 4, running: 2 }, repositories: { 'aeolus-fleet': { path: '/srv/aeolus-fleet' } }, folders: {}, harnesses: { 'claude-code': { flags: [], options: {} } } },
        version: '0.19.0',
        adapterFlags: {},
        riskyFlags: {},
      },
    })();
    const settings = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} };

    const fits = checkSchema.parse(await (await query(address, { procedure: 'requests.check', cookie, input: { settings } })).json()).result.data;
    const refused = checkSchema.parse(await (await query(address, { procedure: 'requests.check', cookie, input: { settings: { ...settings, harness: 'codex' } } })).json()).result.data;

    expect(fits).toEqual({ kind: 'fits' });
    expect(refused).toMatchObject({ kind: 'refused', field: 'harness' });
  });
});

describe('telling argo (#365)', () => {
  it('tells argo once per idempotency key, as its own ship stating the trierarch plugin as its model', async () => {
    const door = createRestFleetDoor(fleetUrl);
    const registered = await door.register({ shipId, secret });
    const crewToken = registered.isOk ? registered.value.crewToken : '';
    const notice = { text: 'Ship scout runs claude-sonnet-5-5, but its crew request asks for claude-opus-5-5.', idempotencyKey: 'trierarch-plugin:test' };

    await expect(door.tellArgo(crewToken, notice)).resolves.toEqual({ isOk: true, value: undefined });
    await expect(door.tellArgo(crewToken, notice)).resolves.toEqual({ isOk: true, value: undefined });

    const inbox = await useCases.readInbox(argo, { filter: 'all' });
    expect(inbox.map((entry) => ({ payload: entry.message.payload, sender: entry.message.sender.name }))).toEqual([{ payload: notice.text, sender: 'trierarch-plugin' }]);
    const listed = await door.listShips(crewToken);
    const self = listed.isOk ? listed.value.find((ship) => ship.shipId === shipId) : undefined;
    expect(self?.model?.id).toBe(`@aeolus-fleet/trierarch-plugin@${runningVersion()}`);
  });
});

describe('a request given back (#382)', () => {
  it("lists the trierarchs that gave it back, so placement leaves them out", async () => {
    const door = createRestFleetDoor(fleetUrl);
    const registered = await door.register({ shipId, secret });
    const crewToken = registered.isOk ? registered.value.crewToken : '';
    const machine = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-studio', type: 'trierarch', fleetScopes: ['crew:run'] }));
    const scout = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'implementer' }));
    unwrap(await useCases.requestCrew(argo, { shipId: scout.shipId, settings: { workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} } }));
    await door.assignCrew(crewToken, { shipId: scout.shipId, trierarchShipId: machine.shipId });
    const machineCaller = { fleetId: argo.fleetId, shipId: machine.shipId, kind: 'agent' as const, scopes: ['messages:send' as const, 'messages:receive' as const, 'crew:run' as const] };
    unwrap(await useCases.giveBackCrewRequest(machineCaller, { shipId: scout.shipId, settingsVersion: 1, reason: 'mac-studio: claude-code 2.1.293 refused claude-opus-5-5' }));

    const listed = await door.listShips(crewToken);

    const request = listed.isOk ? listed.value.find((ship) => ship.shipId === scout.shipId)?.crewRequest : undefined;
    expect(request).toMatchObject({ assignedTo: null, givenBack: [{ trierarchShipId: machine.shipId, reason: 'mac-studio: claude-code 2.1.293 refused claude-opus-5-5' }] });
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
