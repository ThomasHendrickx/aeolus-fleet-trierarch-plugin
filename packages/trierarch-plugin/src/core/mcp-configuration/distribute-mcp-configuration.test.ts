import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { memoryMcpConfigurations } from '../../../test/support/memory-mcp-configurations.js';
import { memoryMcpDeliveries } from '../../../test/support/memory-mcp-deliveries.js';
import type { ListedShip, PluginDelivery } from '../connection/ports.js';
import { err, ok } from '../shared/result.js';
import { createDistributeMcpConfiguration } from './distribute-mcp-configuration.js';
import { isMcpConfigurationCurrent } from './mcp-delivery.js';
import { createReplaceMcpConfiguration } from './replace-mcp-configuration.js';
import { createTakeMcpConfigurationMessage } from './take-mcp-configuration-message.js';

const START = new Date('2026-11-09T12:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-configuration+json';
const APPLIED_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-configuration-applied+json';
const REQUEST_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-configuration-request+json';
/** Public keys shaped as the scheme's (32 bytes as base64), plainly not real ones. */
const MAC_KEY = `${'mac'.padEnd(43, 'A')}=`;
const STUDIO_KEY = `${'studio'.padEnd(43, 'A')}=`;
const NEW_MAC_KEY = `${'macnew'.padEnd(43, 'A')}=`;
/** A key the sealer refuses, as libsodium refuses a low-order point. */
const REFUSED_KEY = `${'refused'.padEnd(43, 'A')}=`;
const GRAPH = { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher'], credential: { secret: 'graph-token', header: 'Authorization' } };
const FIVE_MINUTES_MS = 5 * 60_000;

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let configurations: ReturnType<typeof memoryMcpConfigurations>;
let deliveries: ReturnType<typeof memoryMcpDeliveries>;
let now: Date;
let keys: number;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  configurations = memoryMcpConfigurations();
  deliveries = memoryMcpDeliveries();
  now = START;
  keys = 0;
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: START });
});

function aShip(shipId: ShipId, at: { type?: string; status?: ListedShip['status']; publicKey?: string | null; lastSeenAt?: Date } = {}): void {
  fleet.state.ships = fleet.state.ships.filter((ship) => ship.shipId !== shipId);
  fleet.state.ships.push({ shipId, name: shipId, type: at.type ?? 'trierarch', status: at.status ?? 'crewed', lastSeenAt: at.lastSeenAt ?? START, model: null, crewRequest: null, labels: [] });
  const publicKey = at.publicKey === undefined ? MAC_KEY : at.publicKey;
  fleet.state.reports.set(shipId, { state: 'idle', note: null, reportedAt: START, details: publicKey === null ? {} : { sealingKey: { scheme: 'nacl-sealed-box', publicKey } } });
}

/** A sealer that shows what it sealed to which key, as only a test may, and refuses REFUSED_KEY. */
const sealer = {
  seal: (value: string, publicKey: string) => Promise.resolve(publicKey === REFUSED_KEY ? err({ kind: 'KEY_REFUSED' as const }) : ok(`sealed(${value})to(${publicKey.slice(0, 6)})`)),
};

/** A pass as a process makes it: each new process holds nothing in memory, only what the stores keep. */
const distribute = () =>
  createDistributeMcpConfiguration({ door: fleet.door, connections, configurations, deliveries, sealer, keys: { next: () => `key-${String(keys++)}` }, clock: { now: () => now }, silentAfterMs: FIVE_MINUTES_MS })(FLEET_ID);

async function saveGraph(expectedVersion = 0): Promise<void> {
  const replaced = await createReplaceMcpConfiguration({ configurations, clock: { now: () => now } })({
    fleetId: FLEET_ID,
    actor: { kind: 'operator', accountId: null },
    replacement: { expectedVersion, servers: [GRAPH], secrets: ['graph-token'], secretValues: { 'graph-token': `test-value-${String(expectedVersion)}` } },
  });
  expect(replaced.isOk).toBe(true);
}

const payloads = () => fleet.state.sent.map((each) => z.record(z.string(), z.unknown()).parse(JSON.parse(each.payload)));

describe("distributing a fleet's MCP configuration to its trierarchs", () => {
  it('sends each crewed trierarch that states a key the complete set, its secrets sealed to that key, as the plugin ship', async () => {
    await saveGraph();
    aShip(MAC);
    aShip(STUDIO, { publicKey: STUDIO_KEY });

    await expect(distribute()).resolves.toEqual({ isOk: true, value: { sent: 2, unsealable: [] } });

    expect(fleet.state.sent.map(({ shipId, contentType, idempotencyKey }) => ({ shipId, contentType, idempotencyKey }))).toEqual([
      { shipId: MAC, contentType: CONTENT_TYPE, idempotencyKey: 'key-0' },
      { shipId: STUDIO, contentType: CONTENT_TYPE, idempotencyKey: 'key-1' },
    ]);
    expect(fleet.state.sent[0]?.payload).toBe(
      `{"fleetId":"${FLEET_ID}","pluginShipId":"${SHIP_ID}","version":1,"publicKey":"${MAC_KEY}","servers":[{"name":"company-graph","url":"https://graph.example.invalid/mcp","transport":"streamable-http","tools":["read_neo4j_cypher"],"credential":{"secret":"graph-token","header":"Authorization"}}],"secrets":[{"name":"graph-token","sealed":"sealed(test-value-0)to(macAAA)"}]}`,
    );
  });

  it('sends the empty set at version 0 too, so a trierarch holds what its fleet holds', async () => {
    aShip(MAC);

    await distribute();

    expect(payloads()).toEqual([{ fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: 0, publicKey: MAC_KEY, servers: [], secrets: [] }]);
  });

  it.each([
    { label: 'a trierarch that states no key', ship: () => { aShip(MAC, { publicKey: null }); } },
    { label: 'a trierarch awaiting crew', ship: () => { aShip(MAC, { status: 'awaitingCrew' }); } },
    { label: 'a silent trierarch', ship: () => { aShip(MAC, { lastSeenAt: new Date(START.getTime() - FIVE_MINUTES_MS - 1) }); } },
    { label: 'a ship of another type', ship: () => { aShip(MAC, { type: 'implementer' }); } },
  ])('sends nothing to $label', async ({ ship }) => {
    ship();

    await expect(distribute()).resolves.toEqual({ isOk: true, value: { sent: 0, unsealable: [] } });
    expect(fleet.state.sent).toEqual([]);
  });

  it('sends a trierarch nothing more once it confirmed the current version for its key', async () => {
    aShip(MAC);
    await distribute();
    await deliveries.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied: { version: 0, publicKey: MAC_KEY } });
    now = new Date(START.getTime() + FIVE_MINUTES_MS * 10);
    aShip(MAC, { lastSeenAt: now });

    await distribute();

    expect(fleet.state.sent).toHaveLength(1);
  });

  it('keeps the attempt it could not send and sends the same message under the same key on the next pass, after a restart too', async () => {
    await saveGraph();
    aShip(MAC);
    fleet.state.isAnsweringSends = false;
    await expect(distribute()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(deliveries.held.get(FLEET_ID)?.get(MAC)?.attempt).toMatchObject({ version: 1, publicKey: MAC_KEY, idempotencyKey: 'key-0', sentAt: null });

    fleet.state.isAnsweringSends = true;
    await distribute();

    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0']);
    expect(deliveries.held.get(FLEET_ID)?.get(MAC)?.attempt?.sentAt).toEqual(START);
  });

  it('keeps an attempt the fleet refused for the next pass, the other trierarchs going on', async () => {
    aShip(MAC);
    aShip(STUDIO, { publicKey: STUDIO_KEY });
    fleet.state.refusingSends.add(MAC);

    await expect(distribute()).resolves.toEqual({ isOk: true, value: { sent: 1, unsealable: [] } });
    fleet.state.refusingSends.delete(MAC);
    await distribute();

    expect(fleet.state.sent.map((each) => [each.shipId, each.idempotencyKey])).toEqual([
      [STUDIO, 'key-1'],
      [MAC, 'key-0'],
    ]);
  });

  it('sends an unconfirmed trierarch no new copy within 5 minutes of a sent one, and a new copy under a new key at 5 minutes', async () => {
    aShip(MAC);
    await distribute();

    now = new Date(START.getTime() + FIVE_MINUTES_MS - 1);
    await distribute();
    expect(fleet.state.sent).toHaveLength(1);

    now = new Date(START.getTime() + FIVE_MINUTES_MS);
    aShip(MAC, { lastSeenAt: now });
    await distribute();
    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0', 'key-1']);
  });

  it('sends a confirmed trierarch the new version once a replacement commits', async () => {
    aShip(MAC);
    await distribute();
    await deliveries.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied: { version: 0, publicKey: MAC_KEY } });

    await saveGraph();
    await distribute();

    expect(payloads().map((each) => each.version)).toEqual([0, 1]);
  });

  it('sends a freshly sealed copy of the same version when the trierarch reports a new key', async () => {
    await saveGraph();
    aShip(MAC);
    await distribute();
    await deliveries.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied: { version: 1, publicKey: MAC_KEY } });

    aShip(MAC, { publicKey: NEW_MAC_KEY });
    await distribute();

    expect(payloads()).toMatchObject([
      { version: 1, publicKey: MAC_KEY },
      { version: 1, publicKey: NEW_MAC_KEY, secrets: [{ name: 'graph-token', sealed: 'sealed(test-value-0)to(macnew)' }] },
    ]);
  });

  it('answers a trierarch that asked with a new copy under a new key, even right after a confirmed one', async () => {
    aShip(MAC);
    await distribute();
    await deliveries.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied: { version: 0, publicKey: MAC_KEY } });

    await deliveries.markRequested(FLEET_ID, MAC);
    await distribute();
    await distribute();

    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0', 'key-1']);
  });

  it('sends a new copy to a trierarch released and crewed again between passes with the same key, which is not current until its new lease confirms', async () => {
    const take = createTakeMcpConfigurationMessage({ configurations, deliveries });
    const crew = { fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: START };
    const fromMac = (contentType: string, body: object): PluginDelivery => ({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9h2a', messageId: 'msg_01m3tbfspe96yf1rnr4ank9h2a', contentType, senderShipId: MAC, senderType: 'trierarch', senderStatus: 'crewed', payload: JSON.stringify(body) });
    aShip(MAC);
    await distribute();
    await take(crew, fromMac(APPLIED_CONTENT_TYPE, { fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: 0, publicKey: MAC_KEY }));

    // The new lease's trierarch asks when it starts, under the same key.
    await take(crew, fromMac(REQUEST_CONTENT_TYPE, { fleetId: FLEET_ID, pluginShipId: SHIP_ID }));
    expect(isMcpConfigurationCurrent(deliveries.held.get(FLEET_ID)?.get(MAC), { version: 0, publicKey: MAC_KEY })).toBe(false);

    await distribute();
    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0', 'key-1']);
    expect(isMcpConfigurationCurrent(deliveries.held.get(FLEET_ID)?.get(MAC), { version: 0, publicKey: MAC_KEY })).toBe(false);
  });

  it('forgets the delivery of a trierarch seen not crewed, so its next lease is sent the set again and must confirm again', async () => {
    aShip(MAC);
    await distribute();
    await deliveries.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied: { version: 0, publicKey: MAC_KEY } });

    aShip(MAC, { status: 'awaitingCrew' });
    await distribute();
    expect(deliveries.held.get(FLEET_ID)?.has(MAC)).toBe(false);

    aShip(MAC);
    await distribute();
    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0', 'key-1']);
  });

  it('names a trierarch whose key the sealer refuses, sends it nothing and goes on to the others', async () => {
    await saveGraph();
    aShip(MAC, { publicKey: REFUSED_KEY });
    aShip(STUDIO, { publicKey: STUDIO_KEY });

    await expect(distribute()).resolves.toEqual({ isOk: true, value: { sent: 1, unsealable: [{ shipId: MAC, publicKey: REFUSED_KEY }] } });
    expect(fleet.state.sent.map((each) => each.shipId)).toEqual([STUDIO]);
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(distribute()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
