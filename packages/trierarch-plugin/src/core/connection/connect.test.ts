import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createConnect } from './connect.js';

const AT = new Date('2026-10-03T11:00:00.000Z');

let fleet: ReturnType<typeof fakePluginFleet>;
let store: ReturnType<typeof memoryConnectionStore>;

beforeEach(() => {
  fleet = fakePluginFleet();
  store = memoryConnectionStore();
});

function connect(input: { secret: string; operatorFleetId?: typeof FLEET_ID }) {
  return createConnect({ door: fleet.door, store, clock: { now: () => AT } })({ operatorFleetId: input.operatorFleetId ?? FLEET_ID, shipId: SHIP_ID, secret: input.secret });
}

describe('connecting the trierarch plugin', () => {
  it('registers with the secret, keeps the crew token and answers connected as the ship', async () => {
    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toEqual({
      isOk: true,
      value: { state: 'connected', ship: { shipId: SHIP_ID, name: 'trierarch-plugin' }, lastShipId: SHIP_ID },
    });
    await expect(store.find(FLEET_ID)).resolves.toEqual({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_1', crewedAt: AT });
  });

  it('is refused while the trierarch plugin is connected to the fleet: connect only from not connected', async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: false, error: { kind: 'ALREADY_CONNECTED' } });
    expect(fleet.state.registers).toBe(1);
  });

  it('is refused with a secret the fleet refuses, and keeps nothing', async () => {
    await expect(connect({ secret: 'aeolus_sk_v1_wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    expect(store.held.size).toBe(0);
  });

  it('connects a second fleet while the first stays connected: one connection per fleet', async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });
    fleet.state.fleetId = OTHER_FLEET_ID;
    fleet.state.isCrewed = false;

    await expect(connect({ secret: 'aeolus_sk_v1_good', operatorFleetId: OTHER_FLEET_ID })).resolves.toMatchObject({ isOk: true, value: { state: 'connected' } });
    await expect(store.connected().then((crews) => crews.map((crew) => crew.fleetId).sort())).resolves.toEqual([FLEET_ID, OTHER_FLEET_ID].sort());
  });

  it("is refused for a ship of another fleet than the operator's, and lets the ship go again", async () => {
    fleet.state.fleetId = OTHER_FLEET_ID;

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: false, error: { kind: 'OTHER_FLEET' } });
    expect(store.held.size).toBe(0);
    expect(fleet.state.deregistered).toEqual(['aeolus_ct_v1_1']);
  });

  it.each([
    ['fleet:read', ['messages:send', 'messages:receive', 'fleet:manage', 'crew:assign']],
    ['fleet:manage', ['messages:send', 'messages:receive', 'fleet:read', 'crew:assign']],
    ['crew:assign', ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage']],
  ])('is refused for a ship without %s, and lets the ship go again', async (_missing, scopes) => {
    fleet.state.scopes = scopes;

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: false, error: { kind: 'MISSING_SCOPES' } });
    expect(store.held.size).toBe(0);
    expect(fleet.state.deregistered).toEqual(['aeolus_ct_v1_1']);
  });

  it('connects again after the crew token was dropped, as the same or another ship', async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });
    await store.drop(FLEET_ID);
    fleet.state.isCrewed = false;
    fleet.state.secret = 'aeolus_sk_v1_new';

    await expect(connect({ secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: true, value: { state: 'connected' } });
  });
});
