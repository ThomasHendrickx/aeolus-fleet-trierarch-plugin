import type { ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { OperatorFleet, OperatorSession } from '../../src/core/operator/ports.js';
import { err, ok } from '../../src/core/shared/result.js';
import { FLEET_URL } from './connection-fakes.js';

/**
 * The fleet's calls as the operator's console session makes them: a crewed
 * ship is released, a ship awaiting crew gets a new starting prompt whose
 * secret stops the earlier one working, as core does. The calls are
 * recorded with the session they came with, and a refusal set here answers
 * every call as the fleet would refuse an operator without the right.
 */
export function fakeOperatorFleet() {
  const state: {
    crewed: Set<ShipId>;
    calls: { call: 'release' | 'getStartingPrompt'; shipId: ShipId; session: OperatorSession }[];
    secrets: string[];
    refusal: FleetRefusal | undefined;
  } = {
    crewed: new Set<ShipId>(),
    /** The calls the fleet took, in order, each with the session it came with. */
    calls: new Array<{ call: 'release' | 'getStartingPrompt'; shipId: ShipId; session: OperatorSession }>(),
    /** Each secret issued, in order. */
    secrets: new Array<string>(),
    refusal: undefined,
  };
  const fleet: OperatorFleet = {
    release: (session, { shipId }) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      if (!state.crewed.has(shipId)) {
        return Promise.resolve(err({ code: 'BAD_REQUEST', message: 'The ship awaits crew: get it a new starting prompt instead' }));
      }
      state.calls.push({ call: 'release', shipId, session });
      state.crewed.delete(shipId);
      return Promise.resolve(ok(undefined));
    },
    getStartingPrompt: (session, { shipId }) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      if (state.crewed.has(shipId)) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'The ship is crewed: release it first' }));
      }
      state.calls.push({ call: 'getStartingPrompt', shipId, session });
      const secret = `aeolus_sk_v1_new_${String(state.secrets.length + 1)}`;
      state.secrets.push(secret);
      return Promise.resolve(ok({ prompt: `Register with ship id ${shipId} and secret ${secret}.`, crewLines: [{ harness: 'claude-code', line: `/aeolus:crew ${FLEET_URL} ${shipId} ${secret}` }], secret }));
    },
  };
  return { fleet, state };
}
