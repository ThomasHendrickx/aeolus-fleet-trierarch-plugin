import type { LabelId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createWithdrawNetworkRules } from './withdraw-network-rules.js';

const AT = new Date('2026-10-11T08:00:00.000Z');

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let declarations: Map<ShipId, LabelId | null>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  fleet.state.scopes.push('labels:define', 'labels:assign');
  connections = memoryConnectionStore();
  declarations = new Map();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

function withdraw() {
  return createWithdrawNetworkRules({ door: fleet.door, connections, declarations })(FLEET_ID);
}

describe('withdrawing the trierarch reach (#573, decision 0037)', () => {
  it('declares an empty list, which withdraws its declared rules', async () => {
    const done = await withdraw();

    expect(done).toEqual({ isOk: true, value: { isWithdrawn: true } });
    expect(fleet.state.declarations).toEqual([[]]);
  });

  it('withdraws once: a later pass withdraws nothing again', async () => {
    await withdraw();

    expect(await withdraw()).toEqual({ isOk: true, value: { isWithdrawn: false } });
    expect(fleet.state.declarations).toHaveLength(1);
  });

  it('has nothing to withdraw from a fleet it is not connected to', async () => {
    await connections.drop(FLEET_ID);

    expect(await withdraw()).toEqual({ isOk: true, value: { isWithdrawn: false } });
    expect(fleet.state.declarations).toEqual([]);
  });

  it('has nothing to withdraw when its crew token no longer crews its ship', async () => {
    fleet.state.liveTokens.clear();

    expect(await withdraw()).toEqual({ isOk: true, value: { isWithdrawn: false } });
  });

  it('has nothing to withdraw when its ship holds no labels:define, so it declared none', async () => {
    fleet.state.scopes.splice(0, fleet.state.scopes.length, ...fleet.state.scopes.filter((scope) => scope !== 'labels:define'));

    expect(await withdraw()).toEqual({ isOk: true, value: { isWithdrawn: false } });
  });

  it('is unavailable while the fleet does not answer, and withdraws on the next try', async () => {
    fleet.state.isAnswering = false;

    expect(await withdraw()).toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });

    fleet.state.isAnswering = true;
    expect(await withdraw()).toEqual({ isOk: true, value: { isWithdrawn: true } });
  });
});
