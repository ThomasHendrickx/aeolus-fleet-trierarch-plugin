import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createListMachines } from './list-machines.js';

const AT = new Date('2026-10-06T22:00:00.000Z');
const SEEN = new Date('2026-10-06T22:05:00.000Z');
const MACHINE: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3c';
const AGENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4d';
const RETIRED: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h5e';

/** What a trierarch reports of itself: one harness, one repository, room for four. */
const DETAILS = {
  harnesses: [{ harness: 'claude-code', options: {}, flags: ['--remote-control'] }],
  workspaces: { repositories: ['aeolus-fleet'], folders: [] },
  caps: { ships: 6, running: 4 },
  kept: [],
  orphans: [],
  version: '0.19.0',
};

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
  fleet.state.ships.push(
    { shipId: MACHINE, name: 'mac-studio', type: 'trierarch', status: 'crewed', lastSeenAt: SEEN },
    { shipId: AGENT, name: 'implementer-1', type: 'implementer', status: 'crewed', lastSeenAt: SEEN },
    { shipId: RETIRED, name: 'old-box', type: 'trierarch', status: 'retired', lastSeenAt: null },
  );
});

const list = () => createListMachines({ door: fleet.door, connections })(FLEET_ID);

describe('listing the machines', () => {
  it("lists the fleet's active ships of type trierarch, each with its report and the details its trierarch reported", async () => {
    fleet.state.reports.set(MACHINE, { state: 'working', note: '4 of 6 running', reportedAt: SEEN, details: DETAILS });

    await expect(list()).resolves.toEqual({
      isOk: true,
      value: [{ shipId: MACHINE, name: 'mac-studio', status: 'crewed', lastSeenAt: SEEN, report: { state: 'working', note: '4 of 6 running', reportedAt: SEEN }, details: DETAILS }],
    });
  });

  it('lists a machine that has not reported yet without report or details', async () => {
    await expect(list()).resolves.toMatchObject({ isOk: true, value: [{ shipId: MACHINE, report: null, details: null }] });
  });

  it('reads details that are not a trierarch report as none', async () => {
    fleet.state.reports.set(MACHINE, { state: 'working', note: null, reportedAt: SEEN, details: { mood: 'fine' } });

    await expect(list()).resolves.toMatchObject({ isOk: true, value: [{ shipId: MACHINE, report: { state: 'working' }, details: null }] });
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(list()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('is refused while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    await expect(list()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
