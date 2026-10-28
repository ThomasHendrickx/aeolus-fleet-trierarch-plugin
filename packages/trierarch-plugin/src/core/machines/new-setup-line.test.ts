import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, FLEET_URL, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { fakeOperatorFleet } from '../../../test/support/operator-fleet.js';
import { createNewSetupLine } from './new-setup-line.js';

const AT = new Date('2026-10-28T09:00:00.000Z');
const MACHINE: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3c';
const AGENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4d';
const UNKNOWN: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h6f';

/** The operator's console session, as the console's server forwarded it with the console's Origin. */
const SESSION = { cookie: 'aeolus_session=argo', origin: 'https://console.example.com' };

let fleet: ReturnType<typeof fakePluginFleet>;
let operator: ReturnType<typeof fakeOperatorFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  operator = fakeOperatorFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
  fleet.state.ships.push(
    { shipId: MACHINE, name: 'mac-studio', type: 'trierarch', status: 'awaitingCrew', lastSeenAt: null, model: null, crewRequest: null, labels: [] },
    { shipId: AGENT, name: 'implementer-1', type: 'implementer', status: 'awaitingCrew', lastSeenAt: null, model: null, crewRequest: null, labels: [] },
  );
});

/** Marks the machine's ship crewed, in the plugin's read and in the fleet the operator calls. */
function crewed(shipId: ShipId): void {
  fleet.state.ships = fleet.state.ships.map((ship) => (ship.shipId === shipId ? { ...ship, status: 'crewed' } : ship));
  operator.state.crewed.add(shipId);
}

const newSetupLine = (shipId: ShipId = MACHINE) =>
  createNewSetupLine({ door: fleet.door, connections, operatorFleet: operator.fleet, fleetUrl: FLEET_URL })({ fleetId: FLEET_ID, shipId, session: SESSION });

describe('a new setup line for a machine', () => {
  it("answers a machine awaiting crew a setup line with a new secret, got as the operator, naming the trierarch plugin's ship", async () => {
    await expect(newSetupLine()).resolves.toEqual({
      isOk: true,
      value: {
        shipId: MACHINE,
        setupLine: `npx @aeolus-fleet/trierarch init --fleet-url ${FLEET_URL} --ship-id ${MACHINE} --plugin-ship-id ${SHIP_ID} --secret aeolus_sk_v1_new_1`,
      },
    });
  });

  it('releases a crewed machine first, then gets its new starting prompt, both as the operator with the session it came with', async () => {
    crewed(MACHINE);

    await newSetupLine();

    expect(operator.state.calls).toEqual([
      { call: 'release', shipId: MACHINE, session: SESSION },
      { call: 'getStartingPrompt', shipId: MACHINE, session: SESSION },
    ]);
  });

  it('releases nothing for a machine awaiting crew', async () => {
    await newSetupLine();

    expect(operator.state.calls.map(({ call }) => call)).toEqual(['getStartingPrompt']);
  });

  it("is refused with the fleet's words when the fleet refuses the operator, and no line is built", async () => {
    operator.state.refusal = { code: 'FORBIDDEN', message: 'This call needs the fleet:manage or crew:run scope' };

    await expect(newSetupLine()).resolves.toEqual({
      isOk: false,
      error: { kind: 'FLEET_REFUSED', message: 'This call needs the fleet:manage or crew:run scope' },
    });
  });

  it('gets no new starting prompt when the fleet refuses to release a crewed machine', async () => {
    crewed(MACHINE);
    operator.state.refusal = { code: 'FORBIDDEN', message: 'No rule matches' };

    await newSetupLine();

    expect(operator.state.secrets).toEqual([]);
  });

  it('says the fleet did not answer when it does not, and no line is built', async () => {
    operator.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(newSetupLine()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('is refused for a ship that is not a machine, and calls nothing as the operator', async () => {
    await expect(newSetupLine(AGENT)).resolves.toEqual({ isOk: false, error: { kind: 'NOT_A_MACHINE', message: `${AGENT} is not a machine of this fleet` } });
    expect(operator.state.calls).toEqual([]);
  });

  it('is refused for a ship the fleet does not have', async () => {
    await expect(newSetupLine(UNKNOWN)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_MACHINE' } });
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(newSetupLine()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
