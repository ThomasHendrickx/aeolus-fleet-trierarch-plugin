import type { FleetId } from '@aeolus-fleet/common';

import type { WithdrawNetworkRules } from '../network/withdraw-network-rules.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetForgetter, InstallationRequests, RequestHasher } from './ports.js';
import { earlierAnswer } from './request-id.js';

export type DeleteFleet = (input: { requestId: string; fleetId: FleetId }) => Promise<Result<Record<string, never>, DomainError<'REQUEST_ID_USED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the hosting service deletes a fleet from the trierarch plugin (decision
 * 0021): it withdraws its declared network rules from the fleet first
 * (decision 0037), then forgets everything it holds of the fleet; its ships and
 * the labels it assigned stay there. A fleet must never keep rules nobody can
 * withdraw, so while the fleet does not answer the delete is refused and
 * forgets nothing, for the hosting service to retry. The request is kept as
 * its hash only, so nothing of the fleet stays; a replay answers the first
 * answer.
 */
export function createDeleteFleet(deps: { forgetter: FleetForgetter; requests: InstallationRequests; hasher: RequestHasher; clock: Clock; withdraw: WithdrawNetworkRules }): DeleteFleet {
  return async ({ requestId, fleetId }) => {
    const requestHash = deps.hasher.hash(`deleteFleet ${fleetId}`);
    const earlier = await earlierAnswer(deps.requests, { requestId, requestHash });
    if (earlier !== undefined) {
      return 'isOk' in earlier ? earlier : ok({});
    }
    const withdrawn = await deps.withdraw(fleetId);
    if (!withdrawn.isOk) {
      return withdrawn;
    }
    await deps.forgetter.forget(fleetId);
    await deps.requests.record({ requestId, kind: 'deleteFleet', requestHash, fleetId: null, isEnabled: null, at: deps.clock.now() });
    return ok({});
  };
}
