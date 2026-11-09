import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaMcpConfigurations } from '../src/adapters/prisma/mcp-configurations.js';
import { createPrismaMcpDeliveries } from '../src/adapters/prisma/mcp-deliveries.js';
import { createDistributeMcpConfiguration } from '../src/core/mcp-configuration/distribute-mcp-configuration.js';
import { ok } from '../src/core/shared/result.js';
import { createPluginDatabase } from '../src/testing/database.js';
import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from './support/connection-fakes.js';

// The deliveries of each fleet's MCP configuration in the trierarch plugin's
// own database (the fleet crew MCP design, section 5): one row per trierarch,
// its last attempt kept under its idempotency key before it is sent, so a
// restart sends the very same message again; each change touches its own
// columns only, so a pass and the inbox round never undo each other.

const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const MAC_KEY = `${'mac'.padEnd(43, 'A')}=`;
const AT = new Date('2026-11-09T12:00:00.000Z');
const ATTEMPT = { version: 1, publicKey: MAC_KEY, idempotencyKey: 'key-0', payload: '{"version":1}', sentAt: null };

let databaseUrl: string;
const clients: PrismaClient[] = [];

function aClient(): PrismaClient {
  const client = createPrismaClient(databaseUrl);
  clients.push(client);
  return client;
}

beforeEach(async () => {
  databaseUrl = await createPluginDatabase();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("the deliveries of a fleet's MCP configuration in Postgres", () => {
  it('reads none before the first attempt', async () => {
    await expect(createPrismaMcpDeliveries(aClient()).list(FLEET_ID)).resolves.toEqual([]);
  });

  it('keeps an attempt with its key and message across a restart, and marks it sent only under its own key', async () => {
    await createPrismaMcpDeliveries(aClient()).recordAttempt(FLEET_ID, { trierarchShipId: MAC, attempt: ATTEMPT });

    const restarted = createPrismaMcpDeliveries(aClient());
    await restarted.markSent(FLEET_ID, { trierarchShipId: MAC, idempotencyKey: 'key-other', at: AT });
    await expect(restarted.list(FLEET_ID)).resolves.toEqual([{ trierarchShipId: MAC, attempt: ATTEMPT, applied: null, isRequested: false }]);

    await restarted.markSent(FLEET_ID, { trierarchShipId: MAC, idempotencyKey: 'key-0', at: AT });
    await expect(restarted.list(FLEET_ID)).resolves.toEqual([{ trierarchShipId: MAC, attempt: { ...ATTEMPT, sentAt: AT }, applied: null, isRequested: false }]);
  });

  it('keeps a confirmation and an attempt recorded at once, each by its own call', async () => {
    const pass = createPrismaMcpDeliveries(aClient());
    const inbox = createPrismaMcpDeliveries(aClient());
    await pass.recordAttempt(FLEET_ID, { trierarchShipId: MAC, attempt: ATTEMPT });

    await Promise.all([inbox.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied: { version: 1, publicKey: MAC_KEY } }), pass.markSent(FLEET_ID, { trierarchShipId: MAC, idempotencyKey: 'key-0', at: AT })]);

    await expect(pass.list(FLEET_ID)).resolves.toEqual([{ trierarchShipId: MAC, attempt: { ...ATTEMPT, sentAt: AT }, applied: { version: 1, publicKey: MAC_KEY }, isRequested: false }]);
  });

  it('keeps a request until a new attempt answers it, for a trierarch never sent one too', async () => {
    const deliveries = createPrismaMcpDeliveries(aClient());

    await deliveries.markRequested(FLEET_ID, STUDIO);
    await expect(deliveries.list(FLEET_ID)).resolves.toEqual([{ trierarchShipId: STUDIO, attempt: null, applied: null, isRequested: true }]);

    await deliveries.recordAttempt(FLEET_ID, { trierarchShipId: STUDIO, attempt: ATTEMPT });
    await expect(deliveries.list(FLEET_ID)).resolves.toMatchObject([{ trierarchShipId: STUDIO, isRequested: false }]);
  });

  it("forgets only the trierarchs named, and keeps each fleet's deliveries apart", async () => {
    const deliveries = createPrismaMcpDeliveries(aClient());
    await deliveries.recordAttempt(FLEET_ID, { trierarchShipId: MAC, attempt: ATTEMPT });
    await deliveries.recordAttempt(FLEET_ID, { trierarchShipId: STUDIO, attempt: ATTEMPT });
    await deliveries.recordAttempt(OTHER, { trierarchShipId: MAC, attempt: ATTEMPT });

    await deliveries.forget(FLEET_ID, [MAC]);

    await expect(deliveries.list(FLEET_ID)).resolves.toMatchObject([{ trierarchShipId: STUDIO }]);
    await expect(deliveries.list(OTHER)).resolves.toMatchObject([{ trierarchShipId: MAC }]);
  });

  it("forgets a fleet's deliveries with the fleet", async () => {
    const db = aClient();
    const deliveries = createPrismaMcpDeliveries(db);
    await deliveries.recordAttempt(FLEET_ID, { trierarchShipId: MAC, attempt: ATTEMPT });
    await deliveries.recordAttempt(OTHER, { trierarchShipId: MAC, attempt: ATTEMPT });

    await createPrismaFleetForgetter(db).forget(FLEET_ID);

    await expect(deliveries.list(FLEET_ID)).resolves.toEqual([]);
    await expect(deliveries.list(OTHER)).resolves.toHaveLength(1);
  });

  it('sends the very same message under the same key after a restart that followed a send the fleet did not answer', async () => {
    const fleet = fakePluginFleet();
    const connections = memoryConnectionStore();
    fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
    fleet.state.ships.push({ shipId: MAC, name: 'mac', type: 'trierarch', status: 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] });
    fleet.state.reports.set(MAC, { state: 'idle', note: null, reportedAt: AT, details: { sealingKey: { scheme: 'nacl-sealed-box', publicKey: MAC_KEY } } });
    let sealings = 0;
    // A sealed box differs each time it is made: only the kept message can be sent again under its key.
    const sealer = { seal: (value: string) => Promise.resolve(ok(`sealed-${String(sealings++)}(${value.length})`)) };
    let keys = 0;
    const aProcess = () => {
      const db = aClient();
      return createDistributeMcpConfiguration({
        door: fleet.door,
        connections,
        configurations: createPrismaMcpConfigurations(db),
        deliveries: createPrismaMcpDeliveries(db),
        sealer,
        keys: { next: () => `key-${String(keys++)}` },
        clock: { now: () => AT },
        silentAfterMs: 300_000,
      });
    };
    fleet.state.isAnsweringSends = false;
    await aProcess()(FLEET_ID);

    fleet.state.isAnsweringSends = true;
    await expect(aProcess()(FLEET_ID)).resolves.toEqual({ isOk: true, value: { sent: 1, unsealable: [] } });

    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0']);
    await expect(createPrismaMcpDeliveries(aClient()).list(FLEET_ID)).resolves.toMatchObject([{ attempt: { idempotencyKey: 'key-0', sentAt: AT } }]);
  });
});
