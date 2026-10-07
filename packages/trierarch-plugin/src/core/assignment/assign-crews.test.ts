import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_ASSIGNEE, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createAssignCrews } from './assign-crews.js';

const AT = new Date('2026-10-06T22:00:00.000Z');
const SILENT_AFTER_MS = 5 * 60 * 1000;
const NOW = new Date('2026-10-06T23:00:00.000Z');
const RECENTLY = new Date(NOW.getTime() - 1000);
const LONG_AGO = new Date(NOW.getTime() - SILENT_AFTER_MS - 1);
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const LINUX: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2b';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const LOOKOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3b';

const DETAILS: TrierarchReportDetails = {
  harnesses: [{ harness: 'claude-code', options: {}, flags: [] }],
  workspaces: { repositories: ['aeolus-fleet'], folders: [] },
  caps: { ships: 2, running: 1 },
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

/** A crewed trierarch that reported the details, last seen as given. */
function aTrierarch(shipId: ShipId, at: { lastSeenAt?: Date; details?: TrierarchReportDetails } = {}): void {
  fleet.state.ships.push({ shipId, name: `machine-${shipId.slice(-2)}`, type: 'trierarch', status: 'crewed', lastSeenAt: at.lastSeenAt ?? RECENTLY, crewRequest: null, labels: [] });
  fleet.state.reports.set(shipId, { state: 'idle', note: '0 of 2 running', reportedAt: RECENTLY, details: at.details ?? DETAILS });
}

/** A ship with a crew request, unassigned unless it says otherwise. */
function aRequest(shipId: ShipId, at: { status?: 'awaitingCrew' | 'crewed'; assignedTo?: ShipId; requestedAt?: Date } = {}): void {
  fleet.state.ships.push({
    shipId,
    name: `ship-${shipId.slice(-2)}`,
    type: 'implementer',
    status: at.status ?? 'awaitingCrew',
    lastSeenAt: null,
    crewRequest: { requestedAt: at.requestedAt ?? AT, assignedTo: at.assignedTo ?? null, reason: null },
    labels: [],
  });
  fleet.state.settings.set(shipId, SETTINGS);
}

const assignedTo = (shipId: ShipId) => fleet.state.ships.find((ship) => ship.shipId === shipId)?.crewRequest?.assignedTo;

const pass = () => createAssignCrews({ door: fleet.door, connections, clock: { now: () => NOW }, silentAfterMs: SILENT_AFTER_MS })(FLEET_ID);

describe("a pass of the trierarch plugin's assignment", () => {
  it('claims each unassigned request for the trierarch placement picks', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 1, explained: 0, lost: 0 } });
    expect(assignedTo(SCOUT)).toBe(MAC);
  });

  it('never assigns a crewed ship: crewing it by hand fulfils its request', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT, { status: 'crewed' });

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 0, lost: 0 } });
    expect(assignedTo(SCOUT)).toBeNull();
  });

  it('counts the requests assigned to a trierarch already against its room', async () => {
    aTrierarch(MAC);
    aRequest(LOOKOUT, { assignedTo: MAC });
    aRequest(SCOUT, { assignedTo: MAC });
    aRequest('shp_01m3tbfspe96yf1rnr4ank9h3c');

    await pass();

    expect(fleet.state.explained).toEqual([{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9h3c', reason: 'no trierarch with room: all 1 that fit are full' }]);
  });

  it('writes the reason on a request none fits, and leaves it unassigned', async () => {
    aRequest(SCOUT);

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 1, lost: 0 } });
    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason: 'no trierarch reports yet' }]);
    expect(assignedTo(SCOUT)).toBeNull();
  });

  it('takes a lost claim as no error: the request is read again on the next pass', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);
    fleet.state.isLosingClaims = true;

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 0, lost: 1 } });
    fleet.state.isLosingClaims = false;
    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 0, lost: 0 } });
    expect(assignedTo(SCOUT)).toBe(OTHER_ASSIGNEE);
  });

  it('gives a silent trierarch no new request, and leaves the requests it holds assigned to it', async () => {
    aTrierarch(MAC, { lastSeenAt: LONG_AGO });
    aTrierarch(LINUX);
    aRequest(LOOKOUT, { assignedTo: MAC });
    aRequest(SCOUT);

    await pass();

    expect(assignedTo(SCOUT)).toBe(LINUX);
    expect(assignedTo(LOOKOUT)).toBe(MAC);
  });

  it('considers no trierarch that has not reported details yet', async () => {
    fleet.state.ships.push({ shipId: MAC, name: 'mac-studio', type: 'trierarch', status: 'awaitingCrew', lastSeenAt: null, crewRequest: null, labels: [] });
    aRequest(SCOUT);

    await pass();

    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason: 'no trierarch reports yet' }]);
  });

  it('serves the oldest request first', async () => {
    aTrierarch(MAC, { details: { ...DETAILS, caps: { ships: 1, running: 1 } } });
    aRequest(LOOKOUT, { requestedAt: new Date(AT.getTime() + 1000) });
    aRequest(SCOUT, { requestedAt: AT });

    await pass();

    expect(assignedTo(SCOUT)).toBe(MAC);
    expect(assignedTo(LOOKOUT)).toBeNull();
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(pass()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('is refused while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    await expect(pass()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
