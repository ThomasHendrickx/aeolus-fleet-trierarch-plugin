import type { ConsoleSessionOutput, FleetId, Scope } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/**
 * Outbound port: asks the fleet whether a forwarded console session cookie is
 * a signed-in operator's or a viewer's (`console.session`, decisions 0012 and
 * 0022), with its ship's scopes.
 */
export interface ConsoleSessions {
  check(cookie: string): Promise<Result<{ fleetId: FleetId; kind: ConsoleSessionOutput['kind']; scopes: readonly Scope[] }, FleetRefusal>>;
}
