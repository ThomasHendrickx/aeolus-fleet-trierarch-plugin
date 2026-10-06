import { trierarchReportDetailsSchema, type FleetId, type ShipId, type TrierarchReportDetails } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { TRIERARCH_TYPE } from './join-machine.js';

/** A machine as the trierarch plugin reads it from the fleet: its trierarch's ship, its last report and what it reported it can do. */
export interface Machine {
  shipId: ShipId;
  name: string;
  status: 'awaitingCrew' | 'crewed';
  lastSeenAt: Date | null;
  report: { state: string; note: string | null; reportedAt: Date } | null;
  /** Null until its trierarch reports details, and for details that are not a trierarch's. */
  details: TrierarchReportDetails | null;
}

export type ListMachines = (fleetId: FleetId) => Promise<Result<Machine[], DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the fleet's machines, read from the fleet each time: its active
 * ships of type trierarch, each with its trierarch's last report and the
 * details it reported (decision 0030). The trierarch plugin keeps none of it.
 */
export function createListMachines(deps: { door: FleetDoor; connections: ConnectionStore }): ListMachines {
  const unavailable = (message: string) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer the machines: ${message}`);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listShips(crew.crewToken);
    if (!listed.isOk) {
      return unavailable(listed.error.message);
    }
    const machines: Machine[] = [];
    for (const ship of listed.value) {
      if (ship.type !== TRIERARCH_TYPE || ship.status === 'retired') {
        continue;
      }
      const read = await deps.door.getShip(crew.crewToken, { shipId: ship.shipId });
      if (!read.isOk) {
        return unavailable(read.error.message);
      }
      const { report } = read.value;
      const details = trierarchReportDetailsSchema.safeParse(report?.details);
      machines.push({
        shipId: ship.shipId,
        name: ship.name,
        status: ship.status,
        lastSeenAt: ship.lastSeenAt,
        report: report && { state: report.state, note: report.note, reportedAt: report.reportedAt },
        details: details.success ? details.data : null,
      });
    }
    return ok(machines);
  };
}
