import type { ConsoleSessionOutput, FleetId, ScopeName, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal, IssuedPrompt } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/**
 * Outbound port: asks the fleet whether a forwarded console session cookie is
 * a signed-in operator's or a viewer's (`console.session`, decisions 0012 and
 * 0022), with its ship's scopes.
 */
export interface ConsoleSessions {
  check(cookie: string): Promise<Result<{ fleetId: FleetId; kind: ConsoleSessionOutput['kind']; scopes: readonly ScopeName[] }, FleetRefusal>>;
}

/**
 * The operator's console session as the console's server forwarded it: its
 * cookie and the console's Origin, which the fleet needs on a state-changing
 * call made with the cookie. undefined when the request came with none, which
 * the fleet then refuses.
 */
export interface OperatorSession {
  cookie: string;
  origin: string | undefined;
}

/**
 * Outbound port: the fleet's calls the trierarch plugin makes on behalf of
 * the operator, with the operator's console session, so the operator's own
 * scopes and reach decide (decision 0057), never the plugin's ship's.
 */
export interface OperatorFleet {
  /** Frees a crewed ship from its session: its crew token and secret stop working (`fleet.release`). */
  release(session: OperatorSession, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
  /** A new starting prompt for a ship awaiting crew; its new secret stops any earlier one working (`fleet.getStartingPrompt`). */
  getStartingPrompt(session: OperatorSession, ship: { shipId: ShipId }): Promise<Result<IssuedPrompt, FleetRefusal>>;
}
