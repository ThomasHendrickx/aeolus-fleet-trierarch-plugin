import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStatus, FleetDoor, ConnectionStore } from './ports.js';

export type ReadConnection = (fleetId: FleetId) => Promise<ConnectionStatus>;

/** The codes with which the fleet says a crew token no longer crews its ship. */
const GONE = new Set(['LEASE_ENDED', 'UNAUTHORIZED']);

/**
 * Use case: whether the trierarch plugin is connected to a fleet. The fleet's
 * kept crew token is asked who it is: a token the fleet no longer takes (the
 * ship was released, its session ended) is dropped, and the trierarch plugin
 * is not connected to that fleet until its operator connects it again. When
 * the fleet does not answer, the token is kept.
 */
export function createReadConnection(deps: { door: FleetDoor; store: ConnectionStore }): ReadConnection {
  return async (fleetId) => {
    const crew = await deps.store.find(fleetId);
    if (crew) {
      const who = await deps.door.whoami(crew.crewToken);
      if (who.isOk || !GONE.has(who.error.code)) {
        return { state: 'connected', ship: { shipId: crew.shipId, name: who.isOk ? who.value.name : crew.name }, lastShipId: crew.shipId };
      }
      await deps.store.drop(fleetId);
    }
    const binding = await deps.store.binding(fleetId);
    return { state: 'not-connected', ship: null, lastShipId: binding?.shipId ?? null };
  };
}
