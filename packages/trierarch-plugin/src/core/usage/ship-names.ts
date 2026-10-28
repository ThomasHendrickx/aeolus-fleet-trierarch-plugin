import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UsageBreakdown } from './token-usage.js';

/**
 * The names of the fleet's ships by id, from one read of them, retired ones
 * included, so usage of a ship released long ago keeps its name. Read only for
 * a breakdown of machines or ships: other values are their own names.
 */
export async function readShipNames(
  deps: { door: FleetDoor; connections: ConnectionStore },
  read: { fleetId: FleetId; breakdown: UsageBreakdown | 'kind' | null },
): Promise<Result<ReadonlyMap<string, string> | undefined, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>> {
  if (read.breakdown !== 'machine' && read.breakdown !== 'ship') {
    return ok(undefined);
  }
  const crew = await deps.connections.find(read.fleetId);
  if (!crew) {
    return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
  }
  const listed = await deps.door.listShips(crew.crewToken);
  if (!listed.isOk) {
    return refuse('FLEET_UNAVAILABLE', `The fleet did not answer its ships: ${listed.error.message}`);
  }
  return ok(new Map(listed.value.map((ship): [ShipId, string] => [ship.shipId, ship.name])));
}

/** A value's name: a machine or ship by its name in the fleet, any other value itself; a login not reported has none. */
export function nameOfValue(value: string | null, shipNames: ReadonlyMap<string, string> | undefined): string | null {
  if (value === null) {
    return null;
  }
  return shipNames ? (shipNames.get(value) ?? null) : value;
}
