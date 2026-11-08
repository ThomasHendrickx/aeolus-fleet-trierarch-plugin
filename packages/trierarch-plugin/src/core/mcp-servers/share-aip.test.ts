import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ListedShip } from '../connection/ports.js';
import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createShareAip } from './share-aip.js';

const AT = new Date('2026-11-08T08:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const CONTENT_TYPE = 'application/vnd.aeolus.trierarch.aip+json';
const PAYLOAD = '{"server":"https://aip.example.invalid","tokenSecret":"aip-token"}';
const AIP = { server: 'https://aip.example.invalid', tokenSecret: 'aip-token' };

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let keys: number;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  keys = 0;
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

function aShip(shipId: ShipId, at: { type?: string; status?: ListedShip['status'] } = {}): void {
  fleet.state.ships.push({ shipId, name: shipId, type: at.type ?? 'trierarch', status: at.status ?? 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] });
}

const shareWith = (shared: Set<ShipId>) => createShareAip({ door: fleet.door, connections, keys: { next: () => `key-${String(keys++)}` }, aip: AIP, shared });

describe('sharing the AIP with the trierarchs', () => {
  it('sends it to every trierarch, never the token', async () => {
    aShip(MAC);
    aShip(STUDIO);

    await expect(shareWith(new Set())(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 2 } });
    expect(fleet.state.sent).toEqual([
      { shipId: MAC, contentType: CONTENT_TYPE, payload: PAYLOAD, idempotencyKey: 'key-0' },
      { shipId: STUDIO, contentType: CONTENT_TYPE, payload: PAYLOAD, idempotencyKey: 'key-1' },
    ]);
  });

  it('sends it to no retired trierarch and no ship of another type', async () => {
    aShip(MAC, { status: 'retired' });
    aShip(SCOUT, { type: 'scout' });

    await expect(shareWith(new Set())(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 0 } });
    expect(fleet.state.sent).toEqual([]);
  });

  it('sends it once per process: a trierarch it was sent is skipped', async () => {
    aShip(MAC);
    const share = shareWith(new Set());

    await share(FLEET_ID);
    await expect(share(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 0 } });
    expect(fleet.state.sent).toHaveLength(1);
  });

  it('refuses when the plugin is not connected to the fleet', async () => {
    await connections.remove(FLEET_ID);

    const shared = await shareWith(new Set())(FLEET_ID);

    expect(!shared.isOk && shared.error.code).toBe('NOT_CONNECTED');
  });
});
