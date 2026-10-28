import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import type { OperatorFleet, OperatorSession } from '../operator/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Err, type Result } from '../shared/result.js';
import { TRIERARCH_TYPE } from './join-machine.js';
import { setupLineOf } from './setup-line.js';

export type NewSetupLineRefusal = DomainError<'NOT_CONNECTED' | 'NOT_A_MACHINE' | 'FLEET_REFUSED' | 'FLEET_UNAVAILABLE'>;

/** A machine's new setup line, shown once like the secret it holds. */
export interface NewSetupLine {
  shipId: ShipId;
  setupLine: string;
}

export type MakeNewSetupLine = (input: { fleetId: FleetId; shipId: ShipId; session: OperatorSession }) => Promise<Result<NewSetupLine, NewSetupLineRefusal>>;

/** The fleet's refusal of an operator's call, in its own words; no answer is said as such. */
function refusedBy(refusal: FleetRefusal): Err<NewSetupLineRefusal> {
  return refusal.code === 'UNAVAILABLE' ? refuse('FLEET_UNAVAILABLE', `The fleet did not answer: ${refusal.message}`) : refuse('FLEET_REFUSED', refusal.message);
}

/**
 * Use case: a lost setup line got again (aeolus-fleet#1239). Its line is the
 * one a join gives, with a new secret for the machine's ship: the old line
 * stops working. A crewed machine's ship is released first, so a trierarch
 * already running with it loses its crew; then it gets its new starting
 * prompt. Both calls are the operator's, with the operator's console session,
 * so the operator's own scopes and reach decide (decision 0057). The ship is
 * read with the trierarch plugin's own ship first, so only a machine, a ship
 * of type trierarch, gets a line. The secret is never kept or logged.
 */
export function createNewSetupLine(deps: { door: FleetDoor; connections: ConnectionStore; operatorFleet: OperatorFleet; fleetUrl: string }): MakeNewSetupLine {
  return async ({ fleetId, shipId, session }) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const ship = await deps.door.getShip(crew.crewToken, { shipId });
    if (!ship.isOk) {
      return ship.error.code === 'NOT_FOUND' ? refuse('NOT_A_MACHINE', `${shipId} is not a machine of this fleet`) : refusedBy(ship.error);
    }
    if (ship.value.type !== TRIERARCH_TYPE) {
      return refuse('NOT_A_MACHINE', `${shipId} is not a machine of this fleet`);
    }
    if (ship.value.status === 'crewed') {
      const released = await deps.operatorFleet.release(session, { shipId });
      if (!released.isOk) {
        return refusedBy(released.error);
      }
    }
    const issued = await deps.operatorFleet.getStartingPrompt(session, { shipId });
    if (!issued.isOk) {
      return refusedBy(issued.error);
    }
    return ok({ shipId, setupLine: setupLineOf({ fleetUrl: deps.fleetUrl, shipId, pluginShipId: crew.shipId, secret: issued.value.secret }) });
  };
}
