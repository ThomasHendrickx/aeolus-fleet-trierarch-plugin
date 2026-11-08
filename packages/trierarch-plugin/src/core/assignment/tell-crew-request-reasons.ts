import { argoMessage, CREW_REQUEST_REASON_CONTENT_TYPE, type CrewRequestReasonMessage, type FleetId } from '@aeolus-fleet/common';

import { EVERY_SHIP_STATUS, type ConnectionStore, type FleetDoor, type FleetRefusal, type ListedShip } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { GIVEN_BACK_OPENING, MODEL_NOT_AVAILABLE_OPENING } from './placement.js';

/**
 * What a pass told: the tells the fleet holds that this process had not
 * counted before; those it did not answer, tried again next pass; and those
 * argo's tell was refused, tried no more. After a restart a tell the fleet
 * held already counts once more: the fleet answers a repeat under its key
 * with OK and stores nothing, so the process cannot tell the two apart.
 */
export interface TellOutcome {
  told: number;
  untold: number;
  refused: number;
}

export type TellCrewRequestReasons = (fleetId: FleetId) => Promise<Result<TellOutcome, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusal of a repeated idempotency key with a different request: told before, with an earlier wording of the reason. */
const HELD_ALREADY = 'CONFLICT';

/**
 * The refusals that mean the fleet did not take the call up: no answer, busy
 * after every wait, or the plugin's own crew ended. The same tell may be made
 * again; every other refusal is final for it.
 */
const NOT_ANSWERED = new Set(['UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'LEASE_ENDED']);

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

/** Why argo is told in place of the requester: it records none, it is retired, or the fleet refused the message to it. */
type InPlaceOf = { kind: 'none' } | { kind: 'retired'; name: string } | { kind: 'refused'; name: string; refusal: FleetRefusal };

function whyArgo(inPlaceOf: InPlaceOf): string {
  switch (inPlaceOf.kind) {
    case 'none':
      return 'It records no requester';
    case 'retired':
      return `Ship ${inPlaceOf.name} made it and is retired`;
    case 'refused':
      return `Ship ${inPlaceOf.name} made it, and the fleet refused the message to it (${inPlaceOf.refusal.code}: ${inPlaceOf.refusal.message})`;
  }
}

/** What argo is told in place of a requester: the ship, the reason, and why the requester is not told. */
function argoText(ship: Waiting, inPlaceOf: InPlaceOf): string {
  const { reason, settingsVersion } = ship.crewRequest;
  return argoMessage({
    headline: `Ship ${ship.name} waits: ${reason}`,
    body: `Ship ${ship.name}'s crew request (settings version ${String(settingsVersion)}) waits: ${reason}. ${whyArgo(inPlaceOf)}, so the trierarch plugin tells argo.`,
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
 * requester is retired, is told to argo under the same key, and so is one
 * whose message the fleet refuses for good. A tell the fleet does not answer
 * is left out of `told`, so the next pass tries it again; one argo's tell is
 * refused for good is tried no more. The other requests are told either way.
 */
export function createTellCrewRequestReasons(deps: { door: FleetDoor; connections: ConnectionStore; told: Set<string> }): TellCrewRequestReasons {
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    // Retired ships too: a requester that retired is told to argo, so it must be seen as retired.
    const listed = await deps.door.listShips(crew.crewToken, { statuses: EVERY_SHIP_STATUS });
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the crew request reasons: ${listed.error.message}`);
    }
    const ships = new Map(listed.value.map((ship) => [ship.shipId, ship]));
    const outcome: TellOutcome = { told: 0, untold: 0, refused: 0 };
    for (const ship of listed.value.filter(isWaiting)) {
      const kind = kindOf(ship.crewRequest.reason);
      if (kind === undefined) {
        continue;
      }
      const idempotencyKey = `trierarch-plugin:crew-request-reason:${ship.shipId}:${String(ship.crewRequest.settingsVersion)}:${kind}`;
      if (deps.told.has(idempotencyKey)) {
        continue;
      }
      const { requestedBy } = ship.crewRequest;
      const tellArgo = (inPlaceOf: InPlaceOf) => deps.door.tellArgo(crew.crewToken, { text: argoText(ship, inPlaceOf), idempotencyKey });
      let sent: Result<undefined, FleetRefusal>;
      if (requestedBy === null) {
        sent = await tellArgo({ kind: 'none' });
      } else if (ships.get(requestedBy.shipId)?.status === 'retired') {
        sent = await tellArgo({ kind: 'retired', name: requestedBy.name });
      } else {
        const message: CrewRequestReasonMessage = { shipId: ship.shipId, shipName: ship.name, settingsVersion: ship.crewRequest.settingsVersion, reason: ship.crewRequest.reason };
        sent = await deps.door.send(crew.crewToken, { shipId: requestedBy.shipId, contentType: CREW_REQUEST_REASON_CONTENT_TYPE, payload: JSON.stringify(message), idempotencyKey });
        // A final refusal stores nothing under the key: argo is told under it in place of the requester.
        if (!sent.isOk && !NOT_ANSWERED.has(sent.error.code) && sent.error.code !== HELD_ALREADY) {
          sent = await tellArgo({ kind: 'refused', name: requestedBy.name, refusal: sent.error });
        }
      }
      if (!sent.isOk && NOT_ANSWERED.has(sent.error.code)) {
        outcome.untold += 1;
        continue;
      }
      // CONFLICT: the fleet holds a tell under this key already, with an earlier wording of the reason.
      if (sent.isOk) {
        outcome.told += 1;
      } else if (sent.error.code !== HELD_ALREADY) {
        outcome.refused += 1;
      }
      deps.told.add(idempotencyKey);
    }
    return ok(outcome);
  };
}
