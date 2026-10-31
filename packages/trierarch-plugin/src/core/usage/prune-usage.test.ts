import { describe, expect, it } from 'vitest';

import { FLEET_ID, fakePluginFleet, memoryConnectionStore, SHIP_ID } from '../../../test/support/connection-fakes.js';
import { recordingUsageHistory } from '../../../test/support/memory-usage.js';
import { createPruneUsage } from './prune-usage.js';

// The trierarch plugin keeps each fleet's usage for the fleet's retention
// (the usage design, "Scale and retention"; decision 0066): once an hour it
// prunes what is older, by the days fleet.limits answers its ship.

const NOW = new Date('2026-10-31T12:00:00.000Z');

async function aConnectedFleet(retentionDays: number | null) {
  const fleet = fakePluginFleet();
  fleet.state.retentionDays = retentionDays;
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: NOW });
  return { fleet, connections };
}

function pruneUsage(deps: Awaited<ReturnType<typeof aConnectedFleet>> & { usage: ReturnType<typeof recordingUsageHistory>; isServed?: boolean }) {
  return createPruneUsage({ door: deps.fleet.door, connections: deps.connections, usage: deps.usage, isServed: () => Promise.resolve(deps.isServed ?? true), clock: { now: () => NOW } });
}

describe("the trierarch plugin prunes each fleet's usage by its retention", () => {
  it('prunes the usage older than the days the fleet keeps its history', async () => {
    const usage = recordingUsageHistory();

    await expect(pruneUsage({ ...(await aConnectedFleet(30)), usage })()).resolves.toEqual([{ fleetId: FLEET_ID, outcome: { kind: 'pruned', before: new Date('2026-10-01T12:00:00.000Z') } }]);
    expect(usage.pruned).toEqual([{ fleetId: FLEET_ID, before: new Date('2026-10-01T12:00:00.000Z') }]);
  });

  it('prunes nothing of a fleet that keeps its history for good', async () => {
    const usage = recordingUsageHistory();

    await expect(pruneUsage({ ...(await aConnectedFleet(null)), usage })()).resolves.toEqual([{ fleetId: FLEET_ID, outcome: { kind: 'keptForGood' } }]);
    expect(usage.pruned).toEqual([]);
  });

  it('prunes nothing of a fleet the trierarch plugin is switched off for', async () => {
    const usage = recordingUsageHistory();

    await expect(pruneUsage({ ...(await aConnectedFleet(30)), usage, isServed: false })()).resolves.toEqual([]);
    expect(usage.pruned).toEqual([]);
  });

  it('prunes nothing of a fleet that does not answer its limits, saying so', async () => {
    const connected = await aConnectedFleet(30);
    connected.fleet.state.isAnswering = false;
    const usage = recordingUsageHistory();

    await expect(pruneUsage({ ...connected, usage })()).resolves.toEqual([{ fleetId: FLEET_ID, outcome: { kind: 'refused', refusal: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } } }]);
    expect(usage.pruned).toEqual([]);
  });
});
