import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { err } from '../shared/result.js';
import { createReadConnection } from './read-connection.js';

const AT = new Date('2026-10-03T11:00:00.000Z');

let fleet: ReturnType<typeof fakePluginFleet>;
let store: ReturnType<typeof memoryConnectionStore>;

beforeEach(() => {
  fleet = fakePluginFleet();
  store = memoryConnectionStore();
});

const read = (fleetId = FLEET_ID) => createReadConnection({ door: fleet.door, store })(fleetId);

describe('reading the connection', () => {
  it('is not connected before the trierarch plugin was ever connected', async () => {
    await expect(read()).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
  });

  it('is connected as the ship while its kept crew token works', async () => {
    fleet.state.liveTokens.add('aeolus_ct_v1_kept');
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_kept', crewedAt: AT });

    await expect(read()).resolves.toEqual({ state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID });
  });

  it("reads each fleet's own connection: one fleet connected is not another's", async () => {
    fleet.state.liveTokens.add('aeolus_ct_v1_kept');
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_kept', crewedAt: AT });

    await expect(read(OTHER_FLEET_ID)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
  });

  it('drops a kept crew token the fleet no longer takes, and is not connected, naming the last ship', async () => {
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_released', crewedAt: AT });

    await expect(read()).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: SHIP_ID });
    await expect(store.find(FLEET_ID)).resolves.toBeUndefined();
    await expect(store.binding(FLEET_ID)).resolves.toEqual({ fleetId: FLEET_ID, shipId: SHIP_ID });
  });

  it('stays connected, as the ship it connected as, while the fleet does not answer', async () => {
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_kept', crewedAt: AT });
    const door = { ...fleet.door, whoami: () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })) };

    await expect(createReadConnection({ door, store })(FLEET_ID)).resolves.toEqual({ state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID });
    await expect(store.find(FLEET_ID)).resolves.toBeDefined();
  });
});
