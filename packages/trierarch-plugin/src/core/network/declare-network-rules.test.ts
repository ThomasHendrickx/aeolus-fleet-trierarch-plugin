import { ANY_LABEL_VALUE, type LabelId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createDeclareNetworkRules } from './declare-network-rules.js';
import { createWithdrawNetworkRules } from './withdraw-network-rules.js';

const AT = new Date('2026-10-11T08:00:00.000Z');
const TRIERARCH: LabelId = 'lbl_01m3tbfspe96yf1rnr4ank9h6a';
const OTHER_OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const NEXT_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h7a';

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

/** The fleet's trierarch label, owned by the given ship: the trierarch plugin's own unless said otherwise. */
function aTrierarchLabel(ownerShipId: ShipId = SHIP_ID): void {
  fleet.state.labels.push({ labelId: TRIERARCH, key: 'trierarch', values: [{ valueId: 'lbv_01m3tbfspe96yf1rnr4ank9h6a', value: 'machine' }], ownerShipId });
}

function declare() {
  return createDeclareNetworkRules({ door: fleet.door, connections, declarations })(FLEET_ID);
}

function withdraw() {
  return createWithdrawNetworkRules({ door: fleet.door, connections, declarations })(FLEET_ID);
}

const TRIERARCH_REACH = [{ from: [{ labelId: TRIERARCH, value: ANY_LABEL_VALUE }], to: [{ labelId: TRIERARCH, value: ANY_LABEL_VALUE }] }];

describe('declaring the trierarch reach (#573, decision 0037)', () => {
  it('declares trierarch=* to trierarch=* on the trierarch label it owns', async () => {
    aTrierarchLabel();

    const done = await declare();

    expect(done).toEqual({ isOk: true, value: { isDeclared: true } });
    expect(fleet.state.declarations).toEqual([TRIERARCH_REACH]);
  });

  it('declares once: a later pass that finds the same label declares nothing again', async () => {
    aTrierarchLabel();
    await declare();

    const done = await declare();

    expect(done).toEqual({ isOk: true, value: { isDeclared: false } });
    expect(fleet.state.declarations).toHaveLength(1);
  });

  it('declares nothing while the fleet has no trierarch label yet', async () => {
    expect(await declare()).toEqual({ isOk: true, value: { isDeclared: false } });
    expect(fleet.state.declarations).toEqual([]);
  });

  it('declares nothing while another ship owns the trierarch label', async () => {
    aTrierarchLabel(OTHER_OWNER);

    expect(await declare()).toEqual({ isOk: true, value: { isDeclared: false } });
    expect(fleet.state.declarations).toEqual([]);
  });

  it('declares again for a new ship of the fleet: connected again after its ship was retired', async () => {
    aTrierarchLabel();
    await declare();
    fleet.state.labels.length = 0;
    aTrierarchLabel(NEXT_SHIP);
    await connections.save({ fleetId: FLEET_ID, shipId: NEXT_SHIP, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });

    expect(await declare()).toEqual({ isOk: true, value: { isDeclared: true } });
    expect(fleet.state.declarations).toHaveLength(2);
  });

  it('is unavailable while the fleet does not answer, and declares on the next pass', async () => {
    aTrierarchLabel();
    fleet.state.isAnswering = false;

    expect(await declare()).toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });

    fleet.state.isAnswering = true;
    expect(await declare()).toEqual({ isOk: true, value: { isDeclared: true } });
  });

  it('refuses a fleet it is not connected to', async () => {
    await connections.drop(FLEET_ID);

    expect(await declare()).toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('declares again after it withdrew', async () => {
    aTrierarchLabel();
    await declare();
    await withdraw();

    expect(await declare()).toEqual({ isOk: true, value: { isDeclared: true } });
    expect(fleet.state.declarations).toEqual([TRIERARCH_REACH, [], TRIERARCH_REACH]);
  });
});
