import type { CrewLine, FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { IdempotencyKeys } from './ports.js';

/** The type of every machine's ship: its trierarch's. */
export const TRIERARCH_TYPE = 'trierarch';

/** What a trierarch may do beyond sending and receiving: crew the ships assigned to it (decision 0030). */
const TRIERARCH_SCOPES = ['crew:run'];

/** The package a machine sets up its trierarch with. */
const TRIERARCH_PACKAGE = '@aeolus-fleet/trierarch';

export type JoinRefusal = DomainError<'NOT_CONNECTED' | 'NAME_TAKEN' | 'FLEET_UNAVAILABLE'>;

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

export type JoinMachine = (input: { fleetId: FleetId; name: string }) => Promise<Result<JoinedMachine, JoinRefusal>>;

/**
 * Use case: the operator brings a machine into the fleet. The trierarch
 * plugin commissions its trierarch's ship, of type trierarch with crew:run
 * beside the send and receive every agent ship has, under a new idempotency
 * key, and answers its starting prompt with one ready-to-run setup line built
 * from the fleet's URL, the ship's id and its secret: `aeolus-trierarch init`
 * takes them as flags and never parses a prompt. The secret is never kept or
 * logged.
 */
export function createJoinMachine(deps: { door: FleetDoor; connections: ConnectionStore; keys: IdempotencyKeys; fleetUrl: string }): JoinMachine {
  return async ({ fleetId, name }) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const commissioned = await deps.door.commission(crew.crewToken, { name, type: TRIERARCH_TYPE, fleetScopes: TRIERARCH_SCOPES, idempotencyKey: deps.keys.next() });
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
