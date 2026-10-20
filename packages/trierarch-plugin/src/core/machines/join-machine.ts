import type { ConsoleSessionOutput, CrewLine, FleetId, ScopeName, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { JOIN_SCOPE } from '../scopes/plugin-scopes.js';
import type { IdempotencyKeys } from './ports.js';

/** The type of every machine's ship: its trierarch's. */
export const TRIERARCH_TYPE = 'trierarch';

/** What a trierarch may do beyond sending and receiving: crew the ships assigned to it (decision 0030). */
const TRIERARCH_SCOPES = ['crew:run'];

/** The package a machine sets up its trierarch with. */
const TRIERARCH_PACKAGE = '@aeolus-fleet/trierarch';

export type JoinRefusal = DomainError<'NEEDS_SCOPE' | 'NOT_CONNECTED' | 'NAME_TAKEN' | 'FLEET_UNAVAILABLE'>;

/** Who asks to join a machine, as the fleet answers its session: its kind and its ship's scopes. */
export interface JoiningActor {
  kind: ConsoleSessionOutput['kind'];
  scopes: readonly ScopeName[];
}

/**
 * A joined machine: its trierarch's ship, its starting prompt as the fleet
 * issued it (decision 0019), and the line that sets the machine up, shown
 * once like the secret it holds.
 */
export interface JoinedMachine {
  shipId: ShipId;
  name: string;
  prompt: string;
  crewLines: CrewLine[];
  secret: string;
  setupLine: string;
}

export type JoinMachine = (input: { fleetId: FleetId; name: string; actor: JoiningActor }) => Promise<Result<JoinedMachine, JoinRefusal>>;

/**
 * Use case: an actor brings a machine into the fleet (decision 0055). It
 * needs trierarch-plugin:join, which the trierarch plugin declares and
 * enforces; argo holds every scope, though the fleet lists only core's for
 * it, so argo always may. The trierarch
 * plugin commissions its trierarch's ship, of type trierarch with crew:run
 * beside the send and receive every agent ship has, under a new idempotency
 * key, and answers its starting prompt with one ready-to-run setup line built
 * from the fleet's URL, the ship's id and its secret: `aeolus-trierarch init`
 * takes them as flags and never parses a prompt. The secret is never kept or
 * logged.
 */
export function createJoinMachine(deps: { door: FleetDoor; connections: ConnectionStore; keys: IdempotencyKeys; fleetUrl: string }): JoinMachine {
  return async ({ fleetId, name, actor }) => {
    if (actor.kind !== 'operator' && !actor.scopes.includes(JOIN_SCOPE)) {
      return refuse('NEEDS_SCOPE', `Adding a computer needs ${JOIN_SCOPE}`);
    }
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const commissioned = await deps.door.commission(crew.crewToken, { name, type: TRIERARCH_TYPE, scopes: TRIERARCH_SCOPES, idempotencyKey: deps.keys.next() });
    if (!commissioned.isOk) {
      return commissioned.error.code === 'CONFLICT'
        ? refuse('NAME_TAKEN', commissioned.error.message)
        : refuse('FLEET_UNAVAILABLE', `The fleet did not commission the machine's ship: ${commissioned.error.message}`);
    }
    const { shipId, prompt, crewLines, secret } = commissioned.value;
    const setupLine = `npx ${TRIERARCH_PACKAGE} init --fleet-url ${deps.fleetUrl} --ship-id ${shipId} --secret ${secret}`;
    return ok({ shipId, name, prompt, crewLines, secret, setupLine });
  };
}
