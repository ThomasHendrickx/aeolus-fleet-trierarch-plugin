/** The installation hands over a commissioned ship, replaying only successful requests. */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Connect, ConnectRefusal } from '../connection/connect.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { InstallationRequests, RequestHasher } from './ports.js';
import { earlierAnswer } from './request-id.js';
import type { IsServed } from './served.js';

export type InstallationConnect = (input: {
  requestId: string;
  fleetId: FleetId;
  shipId: ShipId;
  secret: string;
}) => Promise<Result<{ isEnabled: true; isConnected: true }, ConnectRefusal | DomainError<'OFF' | 'REQUEST_ID_USED'>>>;

/** Checks the fleet's switch before replay, then delegates every hand-over check to Connect. */
export function createInstallationConnect(deps: {
  requests: InstallationRequests;
  hasher: RequestHasher;
  clock: Clock;
  isServed: IsServed;
  connect: Connect;
}): InstallationConnect {
  return async ({ requestId, fleetId, shipId, secret }) => {
    if (!(await deps.isServed(fleetId))) {
      return refuse('OFF', 'The trierarch plugin is off for this fleet');
    }
    const requestHash = deps.hasher.hash(`connect ${fleetId} ${shipId}`);
    const earlier = await earlierAnswer(deps.requests, { requestId, requestHash });
    if (earlier !== undefined) {
      return 'isOk' in earlier ? earlier : ok({ isEnabled: true, isConnected: true });
    }
    const connected = await deps.connect({ operatorFleetId: fleetId, shipId, secret });
    if (!connected.isOk) {
      return connected;
    }
    await deps.requests.record({ requestId, kind: 'connect', requestHash, fleetId, isEnabled: null, at: deps.clock.now() });
    return ok({ isEnabled: true, isConnected: true });
  };
}
