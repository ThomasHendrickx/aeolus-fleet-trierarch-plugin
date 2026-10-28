import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { cannedUsageHistory } from '../../../test/support/memory-usage.js';
import { createReadSubscriptionWindows, type WindowsRequest } from './read-subscription-windows.js';
import type { SubscriptionWindows } from './subscription-windows.js';

// The subscription windows of the fleet's machines in a range (the usage
// design, usage.windows): per machine and harness, 20 a page, each machine
// named from the fleet's ships.

const AT = new Date('2026-10-28T08:00:00.000Z');
const NINE = new Date('2026-10-28T09:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3c';
const GONE: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h6f';

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
  fleet.state.ships.push({ shipId: MAC, name: 'trierarch-mac', type: 'trierarch', status: 'retired', lastSeenAt: null, model: null, crewRequest: null, labels: [] });
});

function aRequest(overrides: Partial<WindowsRequest> = {}): WindowsRequest {
  return { fleetId: FLEET_ID, from: NINE, to: new Date('2026-10-29T09:00:00.000Z'), filters: {}, after: null, ...overrides };
}

function aChart(machineShipId: ShipId, harness: string): SubscriptionWindows {
  return { machineShipId, harness, windows: [{ windowMinutes: 300, readings: [{ readAt: NINE, usedPercent: 10, resetsAt: AT }] }] };
}

/** 21 harnesses on one machine: one more than a page. */
const HARNESSES = Array.from({ length: 21 }, (_, index) => aChart(MAC, `harness-${String(index + 1).padStart(2, '0')}`));

function read(windows: readonly SubscriptionWindows[], request: WindowsRequest = aRequest()) {
  return createReadSubscriptionWindows({ usage: cannedUsageHistory({ windows }), door: fleet.door, connections })(request);
}

describe("reading the subscription windows of the fleet's machines", () => {
  it('answers 20 machine and harness charts, and where the next page starts while there are more', async () => {
    const page = await read(HARNESSES);

    expect(page).toMatchObject({ isOk: true, value: { next: { machineShipId: MAC, harness: 'harness-20' } } });
    expect(page.isOk && page.value.charts).toHaveLength(20);
  });

  it('answers the rest after the cursor, and no next page once none is left', async () => {
    const page = await read(HARNESSES, aRequest({ after: { machineShipId: MAC, harness: 'harness-20' } }));

    expect(page).toMatchObject({ isOk: true, value: { charts: [{ harness: 'harness-21' }], next: null } });
  });

  it("names each machine by the fleet's ships, a retired one included, and one the fleet does not know by nothing", async () => {
    const page = await read([aChart(MAC, 'claude-code'), aChart(GONE, 'claude-code')]);

    expect(page).toMatchObject({ isOk: true, value: { charts: [{ machineShipId: MAC, machineName: 'trierarch-mac' }, { machineShipId: GONE, machineName: null }] } });
  });

  it('is refused while the fleet does not answer its ships', async () => {
    fleet.state.isAnswering = false;

    await expect(read([aChart(MAC, 'claude-code')])).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('refuses a range off its grain', async () => {
    await expect(read([], aRequest({ from: new Date('2026-10-28T09:30:00.000Z') }))).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_RANGE' } });
  });
});
