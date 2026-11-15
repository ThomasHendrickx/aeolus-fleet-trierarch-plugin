import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createWatchFleetInboxes } from './watch-fleet-inboxes.js';

async function aWatcher() {
  const connections = memoryConnectionStore();
  for (const fleetId of [FLEET_ID, OTHER_FLEET_ID]) {
    await connections.save({ fleetId, shipId: SHIP_ID, name: 'plugin', crewToken: fleetId, crewedAt: new Date(0) });
  }
  const disabled = new Set<FleetId>();
  const streams = new Map<string, { look: () => Promise<void>; ended: () => Promise<void> }>();
  const stopped: string[] = [];
  const answered: FleetId[] = [];
  const watcher = createWatchFleetInboxes({
    connections,
    isServed: (fleetId) => Promise.resolve(!disabled.has(fleetId)),
    answer: (fleetId) => { answered.push(fleetId); return Promise.resolve(); },
    start: (crewToken, events) => {
      streams.set(crewToken, events);
      return () => { stopped.push(crewToken); };
    },
  });
  await watcher.reconcile();
  return { watcher, connections, disabled, streams, stopped, answered };
}

describe('watching served fleet inboxes', () => {
  it('holds one stream per served fleet and looks only at the fleet that woke', async () => {
    const running = await aWatcher();
    await running.watcher.reconcile();
    expect([...running.streams.keys()]).toEqual([FLEET_ID, OTHER_FLEET_ID]);
    await running.streams.get(OTHER_FLEET_ID)?.look();
    expect(running.answered).toEqual([OTHER_FLEET_ID]);
    expect(running.stopped).toEqual([]);
    running.watcher.close();
  });

  it('stops a disabled or disconnected fleet while another fleet keeps its stream', async () => {
    const running = await aWatcher();
    running.disabled.add(FLEET_ID);
    await running.watcher.reconcile();
    expect(running.stopped).toEqual([FLEET_ID]);
    await running.connections.drop(OTHER_FLEET_ID);
    await running.watcher.reconcile();
    expect(running.stopped).toEqual([FLEET_ID, OTHER_FLEET_ID]);
    running.watcher.close();
  });

  it('replaces a changed lease and never drops its replacement on the old stream ending', async () => {
    const running = await aWatcher();
    const old = running.streams.get(FLEET_ID);
    const crew = await running.connections.find(FLEET_ID);
    if (crew === undefined) { throw new Error('fixture crew missing'); }
    await running.connections.save({ ...crew, crewToken: 'replacement' });
    await running.watcher.reconcile();
    await old?.ended();
    expect((await running.connections.find(FLEET_ID))?.crewToken).toBe('replacement');
    expect(running.stopped).toEqual([FLEET_ID]);
    running.watcher.close();
  });

  it('forgets an ended lease and closes every stream at shutdown', async () => {
    const running = await aWatcher();
    await running.streams.get(FLEET_ID)?.ended();
    expect(await running.connections.find(FLEET_ID)).toBeUndefined();
    running.watcher.close();
    await running.watcher.reconcile();
    expect(running.stopped).toEqual([FLEET_ID, OTHER_FLEET_ID]);
  });
});
