import type { FleetId, Scope } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConsoleSessions } from './ports.js';

export type AuthenticateOperator = (cookie: string | undefined) => Promise<Result<{ fleetId: FleetId; scopes: readonly Scope[] }, DomainError<'NOT_THE_OPERATOR'>>>;

/**
 * Use case: whether a request comes from the operator. The trierarch plugin has no login
 * of its own: the console's server forwards the console session cookie, and
 * the fleet says whose session it is (decisions 0017, 0030). The trierarch plugin serves every
 * fleet at its FLEET_URL, each with its own connection, so any signed-in
 * operator there is let through as the operator of their own fleet. A
 * viewer session is let through too, with the viewer ship's scopes, which
 * the fleet answers; what each scope may call is the API's to check
 * (decision 0022).
 */
export function createAuthenticateOperator(deps: { sessions: ConsoleSessions }): AuthenticateOperator {
  const refusal = refuse('NOT_THE_OPERATOR', 'Sign in to the console of your fleet');
  return async (cookie) => {
    if (cookie === undefined) {
      return refusal;
    }
    const session = await deps.sessions.check(cookie);
    if (!session.isOk) {
      return refusal;
    }
    return ok({ fleetId: session.value.fleetId, scopes: session.value.scopes });
  };
}
