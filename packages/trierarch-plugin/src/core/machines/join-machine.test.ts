import { beforeEach, describe, expect, it } from 'vitest';

import { COMMISSIONED_SHIP_ID, FLEET_ID, FLEET_URL, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createJoinMachine } from './join-machine.js';

const AT = new Date('2026-10-06T22:00:00.000Z');

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

const join = (name = 'mac-studio') =>
  createJoinMachine({
    door: fleet.door,
    connections,
    keys: {
      next: () => {
        keys += 1;
        return `join-${String(keys)}`;
      },
    },
    fleetUrl: FLEET_URL,
  })({ fleetId: FLEET_ID, name });

describe('a machine joining', () => {
  it('commissions a ship of type trierarch with exactly crew:run beside send and receive, named as the operator asked', async () => {
    await join();

    expect(fleet.state.commissioned).toEqual([{ name: 'mac-studio', type: 'trierarch', fleetScopes: ['crew:run'], idempotencyKey: 'join-1' }]);
  });

  it('answers its starting prompt as the fleet issued it, and a setup line for the machine built from its fields', async () => {
    const secret = 'aeolus_sk_v1_machine';

    await expect(join()).resolves.toEqual({
      isOk: true,
      value: {
        shipId: COMMISSIONED_SHIP_ID,
        name: 'mac-studio',
        prompt: `You crew the Aeolus ship mac-studio. Register with ship id ${COMMISSIONED_SHIP_ID} and secret ${secret}.`,
        crewLines: [{ harness: 'claude-code', line: `/aeolus:crew ${FLEET_URL} ${COMMISSIONED_SHIP_ID} ${secret}` }],
        secret,
        setupLine: `npx @aeolus-fleet/trierarch init --fleet-url ${FLEET_URL} --ship-id ${COMMISSIONED_SHIP_ID} --secret ${secret}`,
      },
    });
  });

  it('commissions each join under a new idempotency key', async () => {
    await join('mac-studio');
    await join('linux-box');

    expect(fleet.state.commissioned.map((ship) => ship.idempotencyKey)).toEqual(['join-1', 'join-2']);
  });

  it('is refused while the trierarch plugin is not connected to the fleet, and commissions nothing', async () => {
    await connections.drop(FLEET_ID);

    await expect(join()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('is refused for a name an active ship holds', async () => {
    await join('mac-studio');

    await expect(join('mac-studio')).resolves.toMatchObject({ isOk: false, error: { kind: 'NAME_TAKEN' } });
  });

  it('is refused while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    await expect(join()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
