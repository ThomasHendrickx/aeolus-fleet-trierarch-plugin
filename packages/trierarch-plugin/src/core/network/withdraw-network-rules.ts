import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Declarations } from './declare-network-rules.js';

/** Whether this call withdrew from the fleet: false when there was nothing to withdraw or it withdrew already. */
export type WithdrawNetworkRules = (fleetId: FleetId) => Promise<Result<{ isWithdrawn: boolean }, DomainError<'FLEET_UNAVAILABLE'>>>;

/** The codes with which the fleet says its ship holds no declaration to withdraw: the crew token no longer crews it, or it holds no labels:define. */
const NOTHING_TO_WITHDRAW = new Set(['LEASE_ENDED', 'UNAUTHORIZED', 'FORBIDDEN']);

/**
 * Use case: the trierarch plugin withdraws the network rules it declared
 * (decision 0037) when it is switched off for a fleet or the fleet is deleted
 * from it: it declares an empty list. The labels it assigned stay. Not
 * connected, it has nothing to withdraw. Withdrawn once per ship in this
 * process, until it declares again.
 */
export function createWithdrawNetworkRules(deps: { door: FleetDoor; connections: ConnectionStore; declarations: Declarations }): WithdrawNetworkRules {
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew || deps.declarations.get(crew.shipId) === null) {
      return ok({ isWithdrawn: false });
    }
    const withdrawn = await deps.door.declareNetworkRules(crew.crewToken, { rules: [] });
    if (!withdrawn.isOk && !NOTHING_TO_WITHDRAW.has(withdrawn.error.code)) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not let the trierarch plugin withdraw its network rules: ${withdrawn.error.message}`);
    }
    deps.declarations.set(crew.shipId, null);
    return ok({ isWithdrawn: withdrawn.isOk });
  };
}
