import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import { TRIERARCH_TYPE } from '../machines/join-machine.js';
import type { IdempotencyKeys } from '../machines/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { AIP_CONTENT_TYPE, aipPayload, type Aip } from './aip.js';

export type ShareAip = (fleetId: FleetId) => Promise<Result<{ shared: number }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusal that means no answer came: the pass stops, and the next one tries again. */
const UNAVAILABLE = 'UNAVAILABLE';

/**
 * Use case: one pass of sharing the AIP with a fleet's trierarchs
 * (aeolus-fleet-trierarch-plugin#63), as the MCP servers are shared. Every
 * trierarch ship that is not retired gets it as a message, once per process:
 * `shared` remembers whom this process sent it, so a restart, which may come
 * with a changed AIP, sends it to every trierarch again, under a new
 * idempotency key. A send the fleet refuses leaves that trierarch for the next
 * pass.
 */
export function createShareAip(deps: {
  door: FleetDoor;
  connections: ConnectionStore;
  keys: IdempotencyKeys;
  aip: Aip;
  shared: Set<ShipId>;
}): ShareAip {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer sharing the AIP: ${refusal.message}`);
  const payload = aipPayload(deps.aip);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listShips(crew.crewToken);
    if (!listed.isOk) {
      return unavailable(listed.error);
    }
    let shared = 0;
    for (const ship of listed.value) {
      if (ship.type !== TRIERARCH_TYPE || ship.status === 'retired' || deps.shared.has(ship.shipId)) {
        continue;
      }
      const sent = await deps.door.send(crew.crewToken, { shipId: ship.shipId, contentType: AIP_CONTENT_TYPE, payload, idempotencyKey: deps.keys.next() });
      if (!sent.isOk && sent.error.code === UNAVAILABLE) {
        return unavailable(sent.error);
      }
      if (sent.isOk) {
        deps.shared.add(ship.shipId);
        shared += 1;
      }
    }
    return ok({ shared });
  };
}
