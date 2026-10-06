import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { IsServed } from './served.js';

export type ReadFleet = (input: { fleetId: FleetId }) => Promise<{ isEnabled: boolean; isConnected: boolean }>;

/**
 * Use case: a fleet as the hosting service reads it: whether the trierarch plugin serves
 * it, and whether the trierarch plugin holds a crew token for it. Off and connected is a
 * fleet whose connection waits for it to be on again.
 */
export function createReadFleet(deps: { isServed: IsServed; connections: ConnectionStore }): ReadFleet {
  return async ({ fleetId }) => ({ isEnabled: await deps.isServed(fleetId), isConnected: (await deps.connections.find(fleetId)) !== undefined });
}
