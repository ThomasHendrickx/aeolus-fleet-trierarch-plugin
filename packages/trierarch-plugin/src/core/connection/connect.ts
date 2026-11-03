import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { DeclareScopes } from '../scopes/declare-scopes.js';
import type { ConnectionStatus, FleetDoor, ConnectionStore } from './ports.js';

export type ConnectRefusal = DomainError<'ALREADY_CONNECTED' | 'SECRET_REFUSED' | 'OTHER_FLEET' | 'MISSING_SCOPES'>;

export type Connect = (input: { operatorFleetId: FleetId; shipId: ShipId; secret: string }) => Promise<Result<ConnectionStatus, ConnectRefusal>>;

/**
 * What the trierarch plugin's ship does (decision 0030): read the fleet,
 * commission machines' ships with crew:run, which a commission grants only
 * when its ship holds it (decision 0046), and assign crew requests.
 */
const PLUGIN_SCOPES = ['fleet:read', 'fleet:commission', 'crew:assign', 'crew:run'];

/**
 * Use case: the operator connects the trierarch plugin, as squadrons is
 * connected. The console's server hands it its ship's secret, server to
 * server; the trierarch plugin registers with it as a server and keeps only
 * the crew token. The ship must be of the operator's fleet and hold
 * fleet:read, fleet:commission, crew:assign and crew:run, or the trierarch plugin lets it go
 * again and keeps nothing. Each fleet has its own connection: connect works
 * only while the trierarch plugin is not connected to the operator's fleet,
 * whatever other fleets it serves. Once connected it declares its namespace
 * at once, so a person joining a machine right after is not refused; a refusal
 * does not undo the connection, the periodic pass declares again. The secret is never kept or logged.
 */
export function createConnect(deps: { door: FleetDoor; store: ConnectionStore; clock: Clock; declareScopes: DeclareScopes }): Connect {
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
      return letGo('MISSING_SCOPES', 'The ship needs fleet:read, fleet:commission, crew:assign and crew:run');
    }

    await deps.store.save({ fleetId: who.value.fleetId, shipId, name: who.value.name, crewToken, crewedAt: deps.clock.now() });
    await deps.declareScopes(who.value.fleetId);
    return ok({ state: 'connected', ship: { shipId, name: who.value.name }, lastShipId: shipId });
  };
}
