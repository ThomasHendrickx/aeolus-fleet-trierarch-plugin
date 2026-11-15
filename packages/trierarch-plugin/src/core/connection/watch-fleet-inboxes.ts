/** Maintains one wake stream per served fleet, bound to the lease that opened it. */
import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore } from './ports.js';

interface StreamEvents {
  look: () => Promise<void>;
  ended: () => Promise<void>;
}

interface WatchFleetInboxesDependencies {
  connections: ConnectionStore;
  isServed: (fleetId: FleetId) => Promise<boolean>;
  answer: (fleetId: FleetId) => Promise<void>;
  start: (crewToken: string, events: StreamEvents) => () => void;
}

/** Reconciliation notices connection changes without polling core's inbox. */
export function createWatchFleetInboxes(deps: WatchFleetInboxesDependencies) {
  const streams = new Map<FleetId, { crewToken: string; stop: () => void }>();
  let isClosed = false;
  const isActive = () => !isClosed;
  const stop = (fleetId: FleetId) => {
    streams.get(fleetId)?.stop();
    streams.delete(fleetId);
  };
  return {
    reconcile: async (): Promise<void> => {
      if (isClosed) { return; }
      const served = new Set<FleetId>();
      for (const crew of await deps.connections.connected()) {
        if (!(await deps.isServed(crew.fleetId)) || !isActive()) { continue; }
        served.add(crew.fleetId);
        if (streams.get(crew.fleetId)?.crewToken === crew.crewToken) { continue; }
        stop(crew.fleetId);
        const matches = async () => (await deps.connections.find(crew.fleetId))?.crewToken === crew.crewToken;
        const cancel = deps.start(crew.crewToken, {
          look: async () => {
            if (isActive() && await matches() && await deps.isServed(crew.fleetId)) {
              await deps.answer(crew.fleetId);
            }
          },
          ended: async () => {
            if (await matches()) { await deps.connections.drop(crew.fleetId); }
            if (streams.get(crew.fleetId)?.crewToken === crew.crewToken) { stop(crew.fleetId); }
          },
        });
        streams.set(crew.fleetId, { crewToken: crew.crewToken, stop: cancel });
      }
      for (const fleetId of streams.keys()) {
        if (!served.has(fleetId)) { stop(fleetId); }
      }
    },
    close: (): void => {
      isClosed = true;
      for (const fleetId of streams.keys()) { stop(fleetId); }
    },
  };
}
