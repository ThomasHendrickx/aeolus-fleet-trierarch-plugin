import type { FleetId } from '@aeolus-fleet/common';

import type { WithdrawNetworkRules } from '../network/withdraw-network-rules.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetSwitches, InstallationRequests, RequestHasher } from './ports.js';
import { earlierAnswer } from './request-id.js';

export type SetFleetEnabled = (input: { requestId: string; fleetId: FleetId; isEnabled: boolean }) => Promise<Result<{ fleetId: FleetId; isEnabled: boolean }, DomainError<'REQUEST_ID_USED'>>>;

/**
 * Use case: the hosting service switches the trierarch plugin on or off for a fleet
 * (decision 0021). Off keeps everything of the fleet, so on again resumes, but
 * withdraws its declared network rules at once (decision 0037); while the
 * fleet does not answer, the switch is kept and a later pass withdraws them. A
 * replayed request id answers what it answered first and changes nothing.
 */
export function createSetFleetEnabled(deps: { switches: FleetSwitches; requests: InstallationRequests; hasher: RequestHasher; clock: Clock; withdraw: WithdrawNetworkRules }): SetFleetEnabled {
  return async ({ requestId, fleetId, isEnabled }) => {
    const requestHash = deps.hasher.hash(`setEnabled ${fleetId} ${String(isEnabled)}`);
    const earlier = await earlierAnswer(deps.requests, { requestId, requestHash });
    if (earlier !== undefined) {
      return 'isOk' in earlier ? earlier : ok({ fleetId, isEnabled: earlier.isEnabled === true });
    }
    const at = deps.clock.now();
    await deps.switches.set(fleetId, { isEnabled, at });
    await deps.requests.record({ requestId, kind: 'setEnabled', requestHash, fleetId, isEnabled, at });
    if (!isEnabled) {
      await deps.withdraw(fleetId);
    }
    return ok({ fleetId, isEnabled });
  };
}
