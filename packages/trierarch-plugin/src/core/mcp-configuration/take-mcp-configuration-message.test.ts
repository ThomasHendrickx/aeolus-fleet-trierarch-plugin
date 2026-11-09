import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID } from '../../../test/support/connection-fakes.js';
import { memoryMcpConfigurations } from '../../../test/support/memory-mcp-configurations.js';
import { memoryMcpDeliveries } from '../../../test/support/memory-mcp-deliveries.js';
import type { PluginCrew, PluginDelivery } from '../connection/ports.js';
import { createReplaceMcpConfiguration } from './replace-mcp-configuration.js';
import { createTakeMcpConfigurationMessage } from './take-mcp-configuration-message.js';

const AT = new Date('2026-11-09T12:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const OTHER_PLUGIN: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h9a';
const MAC_KEY = `${'mac'.padEnd(43, 'A')}=`;
const OTHER_KEY = `${'other'.padEnd(43, 'A')}=`;
const APPLIED = 'application/vnd.aeolus.trierarch.mcp-configuration-applied+json';
const REQUEST = 'application/vnd.aeolus.trierarch.mcp-configuration-request+json';
const CREW: PluginCrew = { fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT };

let configurations: ReturnType<typeof memoryMcpConfigurations>;
let deliveries: ReturnType<typeof memoryMcpDeliveries>;
let take: ReturnType<typeof createTakeMcpConfigurationMessage>;

beforeEach(async () => {
  configurations = memoryMcpConfigurations();
  deliveries = memoryMcpDeliveries();
  take = createTakeMcpConfigurationMessage({ configurations, deliveries });
  await createReplaceMcpConfiguration({ configurations, clock: { now: () => AT } })({ fleetId: FLEET_ID, actor: { kind: 'operator', accountId: null }, replacement: { expectedVersion: 0, servers: [], secrets: [], secretValues: {} } });
  await deliveries.recordAttempt(FLEET_ID, { trierarchShipId: MAC, attempt: { version: 1, publicKey: MAC_KEY, idempotencyKey: 'key-0', payload: '{}', sentAt: AT } });
});

function aDelivery(change: Partial<PluginDelivery> & { body?: unknown } = {}): PluginDelivery {
  const { body, ...rest } = change;
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9h2a',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank9h2a',
    contentType: APPLIED,
    senderShipId: MAC,
    senderType: 'trierarch',
    senderStatus: 'crewed',
    payload: JSON.stringify(body ?? { fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: 1, publicKey: MAC_KEY }),
    ...rest,
  };
}

const appliedOf = () => deliveries.held.get(FLEET_ID)?.get(MAC)?.applied ?? null;

describe("a trierarch's confirmation that it applied its fleet's MCP configuration", () => {
  it('is recorded for the trierarch when it names this fleet, this plugin ship, the current version and the key it was sent', async () => {
    await expect(take(CREW, aDelivery())).resolves.toEqual({ kind: 'applied' });

    expect(appliedOf()).toEqual({ version: 1, publicKey: MAC_KEY });
  });

  it.each([
    { label: 'another fleet', body: { fleetId: OTHER_FLEET_ID, pluginShipId: SHIP_ID, version: 1, publicKey: MAC_KEY }, reason: 'it names another fleet or plugin ship' },
    { label: 'another plugin ship', body: { fleetId: FLEET_ID, pluginShipId: OTHER_PLUGIN, version: 1, publicKey: MAC_KEY }, reason: 'it names another fleet or plugin ship' },
    { label: 'an older version', body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: 0, publicKey: MAC_KEY }, reason: 'it confirms version 0, not the current version 1' },
    { label: 'a key it was not sent', body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: 1, publicKey: OTHER_KEY }, reason: 'it confirms a version and key it was not sent' },
    { label: 'a payload of another shape', body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: '1', publicKey: MAC_KEY }, reason: 'its payload is not { fleetId, pluginShipId, version, publicKey }' },
    { label: 'a payload with more fields', body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID, version: 1, publicKey: MAC_KEY, servers: [] }, reason: 'its payload is not { fleetId, pluginShipId, version, publicKey }' },
  ])('is ignored, recording nothing, when it names $label', async ({ body, reason }) => {
    await expect(take(CREW, aDelivery({ body }))).resolves.toEqual({ kind: 'ignored', reason });

    expect(appliedOf()).toBeNull();
  });

  it('is ignored from a ship that is not a trierarch, or a trierarch not crewed', async () => {
    await expect(take(CREW, aDelivery({ senderType: 'implementer' }))).resolves.toEqual({ kind: 'ignored', reason: 'its sender is not a crewed trierarch' });
    await expect(take(CREW, aDelivery({ senderStatus: 'awaitingCrew' }))).resolves.toEqual({ kind: 'ignored', reason: 'its sender is not a crewed trierarch' });

    expect(appliedOf()).toBeNull();
  });

  it('is ignored when its payload is not JSON', async () => {
    await expect(take(CREW, { ...aDelivery(), payload: 'applied' })).resolves.toEqual({ kind: 'ignored', reason: 'its payload is not { fleetId, pluginShipId, version, publicKey }' });
  });

  it('leaves any other message to the rest of the round', async () => {
    await expect(take(CREW, aDelivery({ contentType: 'application/vnd.aeolus.trierarch.usage+json' }))).resolves.toEqual({ kind: 'notMcpConfiguration' });
  });
});

describe("a trierarch asking for its fleet's MCP configuration", () => {
  it('marks its delivery asked, so the next pass sends it a new copy', async () => {
    await expect(take(CREW, aDelivery({ contentType: REQUEST, body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID } }))).resolves.toEqual({ kind: 'requested' });

    expect(deliveries.held.get(FLEET_ID)?.get(MAC)?.isRequested).toBe(true);
  });

  it('forgets at once the confirmation its trierarch gave before, as a trierarch asks when its lease starts', async () => {
    await take(CREW, aDelivery());

    await take(CREW, aDelivery({ contentType: REQUEST, body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID } }));

    expect(appliedOf()).toBeNull();
  });

  it.each([
    { label: 'another fleet', delivery: aDelivery({ contentType: REQUEST, body: { fleetId: OTHER_FLEET_ID, pluginShipId: SHIP_ID } }), reason: 'it names another fleet or plugin ship' },
    { label: 'another shape', delivery: aDelivery({ contentType: REQUEST, body: {} }), reason: 'its payload is not { fleetId, pluginShipId }' },
    { label: 'a sender that is not a trierarch', delivery: aDelivery({ contentType: REQUEST, senderType: 'implementer', body: { fleetId: FLEET_ID, pluginShipId: SHIP_ID } }), reason: 'its sender is not a crewed trierarch' },
  ])('is ignored with $label', async ({ delivery, reason }) => {
    await expect(take(CREW, delivery)).resolves.toEqual({ kind: 'ignored', reason });

    expect(deliveries.held.get(FLEET_ID)?.get(MAC)?.isRequested).toBe(false);
  });
});
