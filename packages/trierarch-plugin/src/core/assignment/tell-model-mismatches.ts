import type { FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ConnectionStore, FleetDoor, FleetRefusal, ListedShip } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

export type TellModelMismatches = (fleetId: FleetId) => Promise<Result<{ told: number }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusal of a repeated idempotency key with a different request: the notice was told before. */
const HELD_ALREADY = 'CONFLICT';

/** The model a crew request's settings ask for, when they name one; any other shape names none. */
const requestedModelSchema = z.object({ options: z.object({ model: z.string() }) });

/** A crewed ship with a crew request whose running session stated a model: one the check can compare. */
type Compared = ListedShip & { model: NonNullable<ListedShip['model']>; crewRequest: NonNullable<ListedShip['crewRequest']> };

/** Whether the ship's crew stated its model since the session its trierarch runs now started: an earlier one may be a former crew's. */
function isComparable(ship: ListedShip): ship is Compared {
  const startedAt = ship.crewRequest?.startedAt ?? null;
  return ship.status === 'crewed' && ship.model !== null && startedAt !== null && ship.model.statedAt >= startedAt;
}

/**
 * Use case: one pass of the model check for a fleet (#365). The trierarch
 * plugin observes only: when a crewed ship's stated model differs from the
 * model its crew request asks for, it tells argo, and changes nothing. It
 * tells once per ship, settings version and stated model: the fleet stores
 * the notice once under its idempotency key, so a restart tells nothing
 * twice, and `checked` keeps this process from reading a compared ship again.
 */
export function createTellModelMismatches(deps: { door: FleetDoor; connections: ConnectionStore; checked: Set<string> }): TellModelMismatches {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer the model check: ${refusal.message}`);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listShips(crew.crewToken);
    if (!listed.isOk) {
      return unavailable(listed.error);
    }
    let told = 0;
    for (const ship of listed.value.filter(isComparable)) {
      const key = `trierarch-plugin:model-mismatch:${ship.shipId}:${String(ship.crewRequest.settingsVersion)}:${ship.model.id}`;
      if (deps.checked.has(key)) {
        continue;
      }
      const read = await deps.door.getShip(crew.crewToken, { shipId: ship.shipId });
      if (!read.isOk) {
        return unavailable(read.error);
      }
      const requested = requestedModelSchema.safeParse(read.value.crewSettings);
      if (requested.success && requested.data.options.model !== ship.model.id) {
        const text = `Ship ${ship.name} runs ${ship.model.id}, but its crew request asks for ${requested.data.options.model}. The trierarch plugin changes nothing.`;
        const sent = await deps.door.tellArgo(crew.crewToken, { text, idempotencyKey: key });
        // CONFLICT: the fleet holds a notice under this key already, sent by an earlier version stating another model.
        if (!sent.isOk && sent.error.code !== HELD_ALREADY) {
          return unavailable(sent.error);
        }
        told += sent.isOk ? 1 : 0;
      }
      deps.checked.add(key);
    }
    return ok({ told });
  };
}
