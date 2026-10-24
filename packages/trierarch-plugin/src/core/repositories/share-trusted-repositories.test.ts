import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ListedShip } from '../connection/ports.js';
import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createShareTrustedRepositories } from './share-trusted-repositories.js';
import { readTrustedRepositories, type TrustedRepositories } from './trusted-repositories.js';

const AT = new Date('2026-10-24T08:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const STUDIO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const CONTENT_TYPE = 'application/vnd.aeolus.trierarch.trusted-repositories+json';
const HEMMA_PAYLOAD = '{"repositories":[{"name":"hemma","url":"git@github.com:ThomasHendrickx/hemma.git"}]}';

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

function aList(listed: Record<string, string>): TrustedRepositories {
  const read = readTrustedRepositories(listed);
  return read.isOk ? read.value : { repositories: [] };
}

const HEMMA = aList({ hemma: 'git@github.com:ThomasHendrickx/hemma.git' });

const shareWith = (shared: Set<ShipId>, list: TrustedRepositories = HEMMA) =>
  createShareTrustedRepositories({ door: fleet.door, connections, keys: { next: () => `key-${String(keys++)}` }, trustedRepositories: list, shared });
const share = (list?: TrustedRepositories) => shareWith(new Set(), list)(FLEET_ID);

describe('sharing the trusted repositories with the trierarchs', () => {
  it('sends the list to every trierarch', async () => {
    aShip(MAC);
    aShip(STUDIO);

    await expect(share()).resolves.toEqual({ isOk: true, value: { shared: 2 } });
    expect(fleet.state.sent).toEqual([
      { shipId: MAC, contentType: CONTENT_TYPE, payload: HEMMA_PAYLOAD, idempotencyKey: 'key-0' },
      { shipId: STUDIO, contentType: CONTENT_TYPE, payload: HEMMA_PAYLOAD, idempotencyKey: 'key-1' },
    ]);
  });

  it('sends an empty list too, so a trierarch stops trusting what left it', async () => {
    aShip(MAC);

    await share(aList({}));

    expect(fleet.state.sent.map((each) => each.payload)).toEqual(['{"repositories":[]}']);
  });

  it('sends a trierarch the list once across passes', async () => {
    aShip(MAC);
    const shared = new Set<ShipId>();

    await shareWith(shared)(FLEET_ID);
    await expect(shareWith(shared)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 0 } });

    expect(fleet.state.sent).toHaveLength(1);
  });

  it('sends a trierarch that joins later the list on the next pass', async () => {
    aShip(MAC);
    const shared = new Set<ShipId>();
    await shareWith(shared)(FLEET_ID);
    aShip(STUDIO);

    await shareWith(shared)(FLEET_ID);

    expect(fleet.state.sent.map((each) => each.shipId)).toEqual([MAC, STUDIO]);
  });

  it('sends every trierarch the list again after a restart of the trierarch plugin, under a new key', async () => {
    aShip(MAC);

    await share();
    await share();

    expect(fleet.state.sent.map((each) => each.idempotencyKey)).toEqual(['key-0', 'key-1']);
  });

  it('sends nothing to a retired trierarch or a ship of another type', async () => {
    aShip(MAC, { status: 'retired' });
    aShip(SCOUT, { type: 'implementer' });

    await share();

    expect(fleet.state.sent).toEqual([]);
  });

  it('sends a trierarch whose send was refused the list again on the next pass, and the others meanwhile', async () => {
    aShip(MAC);
    aShip(STUDIO);
    fleet.state.refusingSends.add(MAC);
    const shared = new Set<ShipId>();

    await expect(shareWith(shared)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { shared: 1 } });
    fleet.state.refusingSends.clear();
    await shareWith(shared)(FLEET_ID);

    expect(fleet.state.sent.map((each) => each.shipId)).toEqual([STUDIO, MAC]);
  });

  it('refuses while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(share()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('refuses while the fleet does not answer', async () => {
    aShip(MAC);
    fleet.state.isAnswering = false;

    await expect(share()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
