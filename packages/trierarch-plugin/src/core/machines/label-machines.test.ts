import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createLabelMachines } from './label-machines.js';

const AT = new Date('2026-10-07T20:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const LINUX: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2c';
const AGENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const OTHER_OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const LABEL_SCOPES = ['labels:define', 'labels:assign'];

function details(machine?: TrierarchReportDetails['machine']): TrierarchReportDetails {
  return {
    harnesses: [{ harness: 'claude-code', options: {}, flags: [] }],
    workspaces: { repositories: ['aeolus-fleet'], folders: [] },
    caps: { ships: 2, running: 1 },
    kept: [],
    orphans: [],
    ...(machine === undefined ? {} : { machine }),
    version: '0.20.0',
  };
}

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  fleet.state.scopes.push(...LABEL_SCOPES);
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

/** A trierarch that reported the machine it runs on, or none. */
function aTrierarch(shipId: ShipId, machine?: TrierarchReportDetails['machine']): void {
  fleet.state.ships.push({ shipId, name: shipId === MAC ? 'trierarch-mac' : 'trierarch-linux', type: 'trierarch', status: 'crewed', lastSeenAt: AT, crewRequest: null, labels: [] });
  fleet.state.reports.set(shipId, { state: 'idle', note: null, reportedAt: AT, details: details(machine) });
}

function labelMachines() {
  return createLabelMachines({ door: fleet.door, connections })(FLEET_ID);
}

describe('machine labels (#102; docs/trierarch.md, Machine labels)', () => {
  it('defines os and arch, which the trierarch plugin owns, and labels each trierarch ship from the machine it reports', async () => {
    aTrierarch(MAC, { os: 'macos', arch: 'arm64' });
    aTrierarch(LINUX, { os: 'linux', arch: 'amd64' });

    const done = await labelMachines();

    expect(done).toMatchObject({ isOk: true, value: { defined: 2, assigned: 4, unassigned: 0 } });
    expect(fleet.state.labelWrites).toEqual([
      'define os=macos,linux,windows',
      'define arch=arm64,amd64',
      'assign trierarch-mac os=macos',
      'assign trierarch-mac arch=arm64',
      'assign trierarch-linux os=linux',
      'assign trierarch-linux arch=amd64',
    ]);
  });

  it('changes nothing on a pass where every trierarch ship carries what its machine reports', async () => {
    aTrierarch(MAC, { os: 'macos', arch: 'arm64' });
    await labelMachines();
    fleet.state.labelWrites.length = 0;

    const done = await labelMachines();

    expect(done).toMatchObject({ isOk: true, value: { defined: 0, assigned: 0, unassigned: 0 } });
    expect(fleet.state.labelWrites).toEqual([]);
  });

  it('moves a trierarch ship to the value its machine reports now, taking the old one off', async () => {
    aTrierarch(MAC, { os: 'macos', arch: 'arm64' });
    await labelMachines();
    fleet.state.reports.set(MAC, { state: 'idle', note: null, reportedAt: AT, details: details({ os: 'linux', arch: 'arm64' }) });
    fleet.state.labelWrites.length = 0;

    await labelMachines();

    expect(fleet.state.labelWrites).toEqual(['assign trierarch-mac os=linux', 'unassign trierarch-mac os=macos']);
  });

  it('takes its labels off a trierarch whose machine no longer names them, and labels no trierarch that reports no machine', async () => {
    aTrierarch(MAC, { os: 'macos', arch: 'arm64' });
    aTrierarch(LINUX);
    await labelMachines();
    fleet.state.reports.set(MAC, { state: 'idle', note: null, reportedAt: AT, details: details({ os: 'macos' }) });
    fleet.state.labelWrites.length = 0;

    await labelMachines();

    expect(fleet.state.labelWrites).toEqual(['unassign trierarch-mac arch=arm64']);
  });

  it('labels only trierarch ships, never the others', async () => {
    fleet.state.ships.push({ shipId: AGENT, name: 'implementer-1', type: 'implementer', status: 'crewed', lastSeenAt: AT, crewRequest: null, labels: [] });
    fleet.state.reports.set(AGENT, { state: 'idle', note: null, reportedAt: AT, details: details({ os: 'linux' }) });

    await labelMachines();

    expect(fleet.state.labelWrites.filter((write) => write.startsWith('assign'))).toEqual([]);
  });

  it('leaves a key another ship owns: it neither defines nor assigns it', async () => {
    fleet.state.labels.push({ labelId: 'lbl_01m3tbfspe96yf1rnr4ank9h5a', key: 'os', values: [{ valueId: 'lbv_01m3tbfspe96yf1rnr4ank9h5a', value: 'macos' }], ownerShipId: OTHER_OWNER });
    aTrierarch(MAC, { os: 'macos', arch: 'arm64' });

    await labelMachines();

    expect(fleet.state.labelWrites).toEqual(['define arch=arm64,amd64', 'assign trierarch-mac arch=arm64']);
  });

  it('labels nothing while its ship holds no label scopes: connected before 0.20.0, its ship is retired and the plugin connected again for them', async () => {
    fleet.state.scopes.splice(0, fleet.state.scopes.length, ...fleet.state.scopes.filter((scope) => !LABEL_SCOPES.includes(scope)));
    aTrierarch(MAC, { os: 'macos', arch: 'arm64' });

    const done = await labelMachines();

    expect(done).toMatchObject({ isOk: true, value: { defined: 0, assigned: 0, unassigned: 0, skipped: 'its ship holds no label scopes, and scopes never change: retire its ship and connect the trierarch plugin again to label machines' } });
    expect(fleet.state.labelWrites).toEqual([]);
  });

  it('refuses a fleet it is not connected to', async () => {
    await connections.drop(FLEET_ID);

    expect(await labelMachines()).toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
