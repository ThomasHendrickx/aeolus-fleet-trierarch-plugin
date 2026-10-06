import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConnectionStatus, FleetDoor, ConnectionStore } from './ports.js';

export type ConnectRefusal = DomainError<'ALREADY_CONNECTED' | 'SECRET_REFUSED' | 'OTHER_FLEET' | 'MISSING_SCOPES'>;

export type Connect = (input: { operatorFleetId: FleetId; shipId: ShipId; secret: string }) => Promise<Result<ConnectionStatus, ConnectRefusal>>;

/** What the trierarch plugin's ship does (decision 0030): read the fleet, commission machines' ships and assign crew requests. */
const PLUGIN_SCOPES = ['fleet:read', 'fleet:manage', 'crew:assign'];

/**
 * Use case: the operator connects the trierarch plugin, as squadrons is
 * connected. The console's server hands it its ship's secret, server to
 * server; the trierarch plugin registers with it as a server and keeps only
 * the crew token. The ship must be of the operator's fleet and hold
 * fleet:read, fleet:manage and crew:assign, or the trierarch plugin lets it go
 * again and keeps nothing. Each fleet has its own connection: connect works
 * only while the trierarch plugin is not connected to the operator's fleet,
 * whatever other fleets it serves. The secret is never kept or logged.
 */
export function createConnect(deps: { door: FleetDoor; store: ConnectionStore; clock: Clock }): Connect {
  return async ({ operatorFleetId, shipId, secret }) => {
    if (await deps.store.find(operatorFleetId)) {
      return refuse('ALREADY_CONNECTED', 'The trierarch plugin is connected to this fleet already');
    }
    const registered = await deps.door.register({ shipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused its ship's secret: ${registered.error.message}`);
    }
    const { crewToken } = registered.value;
    const letGo = async <K extends ConnectRefusal['kind']>(kind: K, message: string) => {
      await deps.door.deregister(crewToken);
      return refuse(kind, message);
    };

    const who = await deps.door.whoami(crewToken);
    if (!who.isOk) {
      return letGo('SECRET_REFUSED', `The fleet refused the new crew token: ${who.error.message}`);
    }
    if (who.value.fleetId !== operatorFleetId) {
      return letGo('OTHER_FLEET', "The ship belongs to another fleet than the operator's");
    }
    const ship = await deps.door.getShip(crewToken, { shipId });
    if (!ship.isOk || !PLUGIN_SCOPES.every((scope) => ship.value.scopes.includes(scope))) {
      return letGo('MISSING_SCOPES', 'The ship needs fleet:read, fleet:manage and crew:assign');
    }

    await deps.store.save({ fleetId: who.value.fleetId, shipId, name: who.value.name, crewToken, crewedAt: deps.clock.now() });
    return ok({ state: 'connected', ship: { shipId, name: who.value.name }, lastShipId: shipId });
  };
}
