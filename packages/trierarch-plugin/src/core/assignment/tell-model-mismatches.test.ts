import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createTellModelMismatches } from './tell-model-mismatches.js';

const AT = new Date('2026-10-08T08:00:00.000Z');
const STARTED = new Date('2026-10-08T09:00:00.000Z');
const STATED = new Date('2026-10-08T09:01:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

/** A crewed ship whose session started at STARTED, with the model its crew stated and the model its request asks for. */
function aCrewedShip(at: { stated?: { id: string; statedAt: Date } | null; requested?: unknown; settingsVersion?: number; startedAt?: Date | null } = {}): void {
  fleet.state.ships.push({
    shipId: SCOUT,
    name: 'scout',
    type: 'implementer',
    status: 'crewed',
    lastSeenAt: STATED,
    model: at.stated === undefined ? { id: 'claude-sonnet-5-5', statedAt: STATED } : at.stated,
    crewRequest: { settingsVersion: at.settingsVersion ?? 1, requestedAt: AT, assignedTo: MAC, reason: null, startedAt: at.startedAt === undefined ? STARTED : at.startedAt },
    labels: [],
  });
  const options = at.requested === undefined ? { model: 'claude-opus-5-5' } : { model: at.requested };
  fleet.state.settings.set(SCOUT, { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options });
}

const tellWith = (checked: Set<string>) => createTellModelMismatches({ door: fleet.door, connections, checked });
const tell = () => tellWith(new Set())(FLEET_ID);

describe("the trierarch plugin's model check", () => {
  it("tells argo when a crewed ship's stated model differs from its request's model", async () => {
    aCrewedShip();

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 1 } });
    expect(fleet.state.told).toEqual([
      {
        text: 'Ship scout runs claude-sonnet-5-5, but its crew request asks for claude-opus-5-5. The trierarch plugin changes nothing.',
        idempotencyKey: `trierarch-plugin:model-mismatch:${SCOUT}:1:claude-sonnet-5-5`,
      },
    ]);
  });

  it('tells argo nothing when the stated model is the requested one', async () => {
    aCrewedShip({ stated: { id: 'claude-opus-5-5', statedAt: STATED } });

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 0 } });
    expect(fleet.state.told).toEqual([]);
  });

  it('tells argo nothing when the request names no model', async () => {
    aCrewedShip({ requested: null });

    await tell();

    expect(fleet.state.told).toEqual([]);
  });

  it('tells argo nothing while the ship states no model', async () => {
    aCrewedShip({ stated: null });

    await tell();

    expect(fleet.state.told).toEqual([]);
  });

  it('tells argo nothing for a model stated before the running session started', async () => {
    aCrewedShip({ stated: { id: 'claude-sonnet-5-5', statedAt: AT } });

    await tell();

    expect(fleet.state.told).toEqual([]);
  });

  it('tells argo nothing while no session of its trierarch runs', async () => {
    aCrewedShip({ startedAt: null });

    await tell();

    expect(fleet.state.told).toEqual([]);
  });

  it('tells argo once across passes', async () => {
    aCrewedShip();
    const checked = new Set<string>();

    await tellWith(checked)(FLEET_ID);
    await expect(tellWith(checked)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 0 } });

    expect(fleet.state.told).toHaveLength(1);
  });

  it('tells argo once across restarts of the trierarch plugin', async () => {
    aCrewedShip();

    await tell();
    await tell();

    expect(fleet.state.told).toHaveLength(1);
  });

  it('counts a notice the fleet holds under its key already, from an earlier version of the trierarch plugin, as told', async () => {
    aCrewedShip();
    fleet.state.told.push({ text: 'told by an earlier version', idempotencyKey: `trierarch-plugin:model-mismatch:${SCOUT}:1:claude-sonnet-5-5` });

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 0 } });
    expect(fleet.state.told).toHaveLength(1);
  });

  it('tells argo again for a new settings version', async () => {
    aCrewedShip();
    await tell();
    fleet.state.ships.splice(0);
    aCrewedShip({ settingsVersion: 2 });

    await tell();

    expect(fleet.state.told).toHaveLength(2);
  });

  it('refuses while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(tell()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('refuses while the fleet does not answer', async () => {
    aCrewedShip();
    fleet.state.isAnswering = false;

    await expect(tell()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
