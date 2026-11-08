import { argoMessage, CREW_REQUEST_REASON_CONTENT_TYPE, type CrewRequestReasonMessage, type FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal, ListedShip } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { GIVEN_BACK_OPENING, MODEL_NOT_AVAILABLE_OPENING } from './placement.js';

/** What a pass told: the tells the fleet stored, and those it refused or did not answer, tried again next pass. */
export interface TellOutcome {
  told: number;
  untold: number;
}

export type TellCrewRequestReasons = (fleetId: FleetId) => Promise<Result<TellOutcome, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusal of a repeated idempotency key with a different request: told before, with an earlier wording of the reason. */
const HELD_ALREADY = 'CONFLICT';

/** The kinds of reason a requester is told, each once per settings version (R4). */
type ReasonKind = 'model' | 'givenBack';

/** A request waiting unassigned with a reason of a told kind. */
type Waiting = ListedShip & { crewRequest: NonNullable<ListedShip['crewRequest']> & { reason: string } };

function kindOf(reason: string): ReasonKind | undefined {
  if (reason.startsWith(MODEL_NOT_AVAILABLE_OPENING)) {
    return 'model';
  }
  return reason.startsWith(GIVEN_BACK_OPENING) ? 'givenBack' : undefined;
}

function isWaiting(ship: ListedShip): ship is Waiting {
  return ship.status === 'awaitingCrew' && ship.crewRequest !== null && ship.crewRequest.assignedTo === null && ship.crewRequest.reason !== null;
}

/** What argo is told in place of a requester: the ship, the reason, and why the requester is not told. */
function argoText(ship: Waiting, requester: { name: string } | undefined): string {
  const { reason, settingsVersion } = ship.crewRequest;
  const why = requester === undefined ? 'It records no requester' : `Ship ${requester.name} made it and is retired`;
  return argoMessage({
    headline: `Ship ${ship.name} waits: ${reason}`,
    body: `Ship ${ship.name}'s crew request (settings version ${String(settingsVersion)}) waits: ${reason}. ${why}, so the trierarch plugin tells argo.`,
  });
}

/**
 * Use case: telling the ship that made a crew request why it waits
 * (docs/design/enabled-models-for-ships.md, R4 and R5), after each
 * assignment pass. Only a model that is not available and a request every
 * trierarch that fits gave back are told, once per ship, settings version and
 * kind: the fleet stores each tell once under its idempotency key, so a
 * restart and a rewritten reason tell nothing again, and `told` keeps this
 * process from sending one twice. A request with no requester, or whose
 * requester is retired, is told to argo under the same key. A tell the fleet
 * refuses or does not answer is left out of `told`, so the next pass tries
 * it again; the other requests are told either way.
 */
export function createTellCrewRequestReasons(deps: { door: FleetDoor; connections: ConnectionStore; told: Set<string> }): TellCrewRequestReasons {
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listShips(crew.crewToken);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the crew request reasons: ${listed.error.message}`);
    }
    const ships = new Map(listed.value.map((ship) => [ship.shipId, ship]));
    const outcome: TellOutcome = { told: 0, untold: 0 };
    for (const ship of listed.value.filter(isWaiting)) {
      const kind = kindOf(ship.crewRequest.reason);
      if (kind === undefined) {
        continue;
      }
      const key = `trierarch-plugin:crew-request-reason:${ship.shipId}:${String(ship.crewRequest.settingsVersion)}:${kind}`;
      if (deps.told.has(key)) {
        continue;
      }
      const { requestedBy } = ship.crewRequest;
      // A requester the list does not show is outside read reach, not known to be retired: it is told.
      const isRetired = requestedBy !== null && ships.get(requestedBy.shipId)?.status === 'retired';
      const message: CrewRequestReasonMessage = { shipId: ship.shipId, shipName: ship.name, settingsVersion: ship.crewRequest.settingsVersion, reason: ship.crewRequest.reason };
      const sent: Result<undefined, FleetRefusal> =
        requestedBy === null || isRetired
          ? await deps.door.tellArgo(crew.crewToken, { text: argoText(ship, requestedBy ?? undefined), idempotencyKey: key })
          : await deps.door.send(crew.crewToken, { shipId: requestedBy.shipId, contentType: CREW_REQUEST_REASON_CONTENT_TYPE, payload: JSON.stringify(message), idempotencyKey: key });
      // CONFLICT: the fleet holds a tell under this key already, with an earlier wording of the reason.
      if (!sent.isOk && sent.error.code !== HELD_ALREADY) {
        outcome.untold += 1;
        continue;
      }
      outcome.told += sent.isOk ? 1 : 0;
      deps.told.add(key);
    }
    return ok(outcome);
  };
}
