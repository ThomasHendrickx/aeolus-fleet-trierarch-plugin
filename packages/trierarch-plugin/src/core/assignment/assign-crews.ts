import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { place } from './placement.js';
import { readPlacement } from './read-placement.js';

/** What a pass did: the claims it won, the reasons it wrote, and the claims another assigner or a change won first. */
export interface AssignOutcome {
  assigned: number;
  explained: number;
  lost: number;
}

export type AssignCrews = (fleetId: FleetId) => Promise<Result<AssignOutcome, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusals that mean the request changed since it was read (claimed, crewed or removed): read again on the next pass. */
const CHANGED = new Set(['CONFLICT', 'NOT_FOUND']);

/**
 * Use case: one pass of assignment for a fleet (docs/trierarch.md,
 * "Assignment"). It reads the fleet whole each time: the unassigned requests
 * of ships that await crew, and the trierarchs that report details and are
 * not silent, with the requests assigned to each. Placement decides; each
 * claim is optimistic, and one the fleet refuses because the request changed
 * is no error: the next pass reads it again. A silent trierarch gets nothing
 * new and keeps what it holds.
 */
export function createAssignCrews(deps: { door: FleetDoor; connections: ConnectionStore; clock: Clock; silentAfterMs: number }): AssignCrews {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer the assignment: ${refusal.message}`);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const read = await readPlacement(deps.door, { crewToken: crew.crewToken, now: deps.clock.now(), silentAfterMs: deps.silentAfterMs });
    if (!read.isOk) {
      return unavailable(read.error);
    }
    const { requests, trierarchs } = read.value;

    const outcome: AssignOutcome = { assigned: 0, explained: 0, lost: 0 };
    for (const placement of place(requests, trierarchs)) {
      const done =
        placement.kind === 'assign'
          ? await deps.door.assignCrew(crew.crewToken, { shipId: placement.shipId, trierarchShipId: placement.trierarchShipId })
          : await deps.door.explainCrewRequest(crew.crewToken, { shipId: placement.shipId, reason: placement.reason });
      if (!done.isOk && !CHANGED.has(done.error.code)) {
        return unavailable(done.error);
      }
      if (placement.kind === 'explain') {
        outcome.explained += done.isOk ? 1 : 0;
      } else if (done.isOk) {
        outcome.assigned += 1;
      } else {
        outcome.lost += 1;
      }
    }
    return ok(outcome);
  };
}
