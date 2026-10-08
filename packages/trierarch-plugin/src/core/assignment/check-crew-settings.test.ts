import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createCheckCrewSettings } from './check-crew-settings.js';

const AT = new Date('2026-10-07T09:00:00.000Z');
const SILENT_AFTER_MS = 5 * 60 * 1000;
const NOW = new Date('2026-10-07T10:00:00.000Z');
const RECENTLY = new Date(NOW.getTime() - 1000);
const LONG_AGO = new Date(NOW.getTime() - SILENT_AFTER_MS - 1);
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';

const DETAILS: TrierarchReportDetails = {
  harnesses: [{ harness: 'claude-code', options: {}, flags: [] }],
  workspaces: { repositories: ['aeolus-fleet'], folders: [] },
  caps: { ships: 1, running: 1 },
  kept: [],
  orphans: [],
  version: '0.19.0',
};
const SETTINGS = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} };

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

function aTrierarch(shipId: ShipId, lastSeenAt = RECENTLY): void {
  fleet.state.ships.push({ shipId, name: 'trierarch-mac', type: 'trierarch', status: 'crewed', lastSeenAt, crewRequest: null, labels: [] });
  fleet.state.reports.set(shipId, { state: 'idle', note: null, reportedAt: lastSeenAt, details: DETAILS });
}

const check = (settings: unknown) => createCheckCrewSettings({ door: fleet.door, connections, clock: { now: () => NOW }, silentAfterMs: SILENT_AFTER_MS })(FLEET_ID, settings);

describe('checking crew settings against the fleet’s trierarchs (#245)', () => {
  it('fits on a trierarch that offers them and has room', async () => {
    aTrierarch(MAC);

    await expect(check(SETTINGS)).resolves.toEqual({ isOk: true, value: { kind: 'fits' } });
  });

  it('names the field no trierarch offers', async () => {
    aTrierarch(MAC);

    await expect(check({ ...SETTINGS, harness: 'codex' })).resolves.toMatchObject({ isOk: true, value: { kind: 'refused', field: 'harness' } });
  });

  it('says there is no room once the requests assigned to the trierarch fill it', async () => {
    aTrierarch(MAC);
    fleet.state.ships.push({ shipId: SCOUT, name: 'scout', type: 'implementer', status: 'crewed', lastSeenAt: null, model: null, crewRequest: { settingsVersion: 1, requestedAt: AT, assignedTo: MAC, reason: null, startedAt: null }, labels: [] });

    await expect(check(SETTINGS)).resolves.toMatchObject({ isOk: true, value: { kind: 'noRoom' } });
  });

  it('leaves out a silent trierarch, as assignment does', async () => {
    aTrierarch(MAC, LONG_AGO);

    await expect(check(SETTINGS)).resolves.toEqual({ isOk: true, value: { kind: 'noRoom', reason: 'no trierarch reports yet' } });
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(check(SETTINGS)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
