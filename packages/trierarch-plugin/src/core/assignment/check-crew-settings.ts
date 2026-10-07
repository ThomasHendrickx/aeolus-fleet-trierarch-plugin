import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { checkPlacement, type PlacementCheck } from './placement.js';
import { readPlacement } from './read-placement.js';

export type CheckCrewSettings = (fleetId: FleetId, settings: unknown) => Promise<Result<PlacementCheck, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: whether crew settings would be placed now, before a request is
 * made (#245): read the fleet's trierarchs as assignment does, and check the
 * settings by placement's rules. It writes nothing; the request itself goes
 * to the fleet, and assignment places it as always.
 */
export function createCheckCrewSettings(deps: { door: FleetDoor; connections: ConnectionStore; clock: Clock; silentAfterMs: number }): CheckCrewSettings {
  return async (fleetId, settings) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const read = await readPlacement(deps.door, { crewToken: crew.crewToken, now: deps.clock.now(), silentAfterMs: deps.silentAfterMs });
    if (!read.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the check: ${read.error.message}`);
    }
    return ok(checkPlacement(settings, read.value.trierarchs));
  };
}
