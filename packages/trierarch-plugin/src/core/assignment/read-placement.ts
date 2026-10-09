import { trierarchReportDetailsSchema } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal } from '../connection/ports.js';
import { TRIERARCH_TYPE } from '../machines/join-machine.js';
import { isSilent } from '../machines/silent.js';
import { ok, type Result } from '../shared/result.js';
import type { PlacementRequest, PlacementTrierarch } from './placement.js';

/**
 * What placement reads from the fleet, whole, each time (docs/trierarch.md,
 * "Assignment"): the unassigned requests of ships that await crew, and the
 * trierarchs that report details and are not silent, with the requests
 * assigned to each. A silent trierarch gets nothing new.
 */
export async function readPlacement(
  door: FleetDoor,
  at: { crewToken: string; now: Date; silentAfterMs: number },
): Promise<Result<{ requests: PlacementRequest[]; trierarchs: PlacementTrierarch[] }, FleetRefusal>> {
  const listed = await door.listShips(at.crewToken);
  if (!listed.isOk) {
    return listed;
  }
  const trierarchs: PlacementTrierarch[] = [];
  const requests: PlacementRequest[] = [];
  for (const ship of listed.value) {
    const isTrierarch = ship.type === TRIERARCH_TYPE && ship.status !== 'retired' && !isSilent(ship.lastSeenAt, { now: at.now, silentAfterMs: at.silentAfterMs });
    const isRequest = ship.status === 'awaitingCrew' && ship.crewRequest !== null && ship.crewRequest.assignedTo === null;
    if (!isTrierarch && !isRequest) {
      continue;
    }
    const read = await door.getShip(at.crewToken, { shipId: ship.shipId });
    if (!read.isOk) {
      return read;
    }
    const details = trierarchReportDetailsSchema.safeParse(read.value.report?.details);
    if (isTrierarch && details.success) {
      const assigned = listed.value.filter((each) => each.crewRequest?.assignedTo === ship.shipId).length;
      trierarchs.push({ shipId: ship.shipId, commissionedAt: read.value.commissionedAt, details: details.data, assigned, labelValueIds: ship.labels.map((label) => label.valueId) });
    }
    if (isRequest && ship.crewRequest !== null) {
      requests.push({
        shipId: ship.shipId,
        requestedAt: ship.crewRequest.requestedAt,
        settings: read.value.crewSettings,
        reason: ship.crewRequest.reason,
        givenBack: ship.crewRequest.givenBack,
      });
    }
  }
  return ok({ requests, trierarchs });
}
