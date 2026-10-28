import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { cannedUsageHistory } from '../../../test/support/memory-usage.js';
import { createReadUsageValues, type UsageValuesRequest } from './read-usage-values.js';
import type { UsageValue } from './usage-values.js';

// The values of one breakdown in a range, for the Usage page's filter menus
// (the usage design, usage.values): 20 a page, largest first, machines and
// ships named from the fleet's ships.

const AT = new Date('2026-10-28T08:00:00.000Z');
const NINE = new Date('2026-10-28T09:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3c';
const NO_USAGE = { series: [], buckets: [], unpricedModels: [] };

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
  fleet.state.ships.push({ shipId: MAC, name: 'trierarch-mac', type: 'trierarch', status: 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] });
});

function aRequest(overrides: Partial<UsageValuesRequest> = {}): UsageValuesRequest {
  return { fleetId: FLEET_ID, from: NINE, to: new Date('2026-10-29T09:00:00.000Z'), breakdown: 'model', after: null, ...overrides };
}

/** n models, model-01 with the most tokens. */
function models(count: number): UsageValue[] {
  return Array.from({ length: count }, (_, index) => ({ value: `model-${String(index + 1).padStart(2, '0')}`, tokens: 1000 - index }));
}

function read(values: readonly UsageValue[], request: UsageValuesRequest = aRequest()) {
  return createReadUsageValues({ usage: cannedUsageHistory(NO_USAGE, values), door: fleet.door, connections })(request);
}

describe("reading the values of one breakdown of the fleet's usage", () => {
  it('answers a page of 20, and where the next page starts while there are more', async () => {
    const page = await read(models(21));

    expect(page).toMatchObject({ isOk: true, value: { next: { tokens: 981, value: 'model-20' } } });
    expect(page.isOk && page.value.values).toHaveLength(20);
  });

  it('answers the rest after the cursor, and no next page once none is left', async () => {
    const page = await read(models(21), aRequest({ after: { tokens: 981, value: 'model-20' } }));

    expect(page).toEqual({ isOk: true, value: { values: [{ value: 'model-21', name: 'model-21', tokens: 980 }], next: null } });
  });

  it('answers no next page when exactly 20 values are left', async () => {
    const page = await read(models(20));

    expect(page).toMatchObject({ isOk: true, value: { next: null } });
  });

  it("names machines by the fleet's ships", async () => {
    const page = await read([{ value: MAC, tokens: 10 }], aRequest({ breakdown: 'machine' }));

    expect(page).toEqual({ isOk: true, value: { values: [{ value: MAC, name: 'trierarch-mac', tokens: 10 }], next: null } });
  });

  it('names a login not reported by nothing', async () => {
    const page = await read([{ value: null, tokens: 10 }], aRequest({ breakdown: 'login' }));

    expect(page).toEqual({ isOk: true, value: { values: [{ value: null, name: null, tokens: 10 }], next: null } });
  });

  it('refuses a range off its grain', async () => {
    const page = await read(models(1), aRequest({ from: new Date('2026-10-28T09:30:00.000Z') }));

    expect(page).toMatchObject({ isOk: false, error: { kind: 'INVALID_RANGE' } });
  });
});
