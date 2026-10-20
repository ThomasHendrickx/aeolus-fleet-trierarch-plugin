import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { JOIN_SCOPE, PLUGIN_NAMESPACE, PLUGIN_SCOPES } from './plugin-scopes.js';

/** Whether this pass declared the namespace: false when its own ship holds it already, or another ship does. */
export type DeclareScopes = (fleetId: FleetId) => Promise<Result<{ isDeclared: boolean }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the trierarch plugin takes up its namespace `trierarch` in
 * a fleet with its scopes (decisions 0046 and 0055), which it enforces itself.
 * Each pass asks while its own ship does not hold it. While another ship
 * holds it the trierarch plugin declares nothing and tells argo, once.
 */
export function createDeclareScopes(deps: { door: FleetDoor; connections: Pick<ConnectionStore, 'find'> }): DeclareScopes {
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listScopes(crew.crewToken);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer its namespaces: ${listed.error.message}`);
    }
    const held = listed.value.find((each) => each.namespace === PLUGIN_NAMESPACE);
    if (held?.declaredBy === crew.shipId) {
      return ok({ isDeclared: false });
    }
    if (held) {
      const told = await deps.door.tellArgo(crew.crewToken, {
        text:
          `The trierarch plugin cannot declare its scopes: another ship holds ${PLUGIN_NAMESPACE}\n\n` +
          `- The trierarch plugin's ship: ${crew.name}\n- Held by: ${held.declaredBy ?? 'core'}\n\n` +
          `Until that ship is retired, no ship holds ${JOIN_SCOPE}, so only argo adds a computer.`,
        idempotencyKey: `namespace-taken-${crew.shipId}`,
      });
      return told.isOk ? ok({ isDeclared: false }) : refuse('FLEET_UNAVAILABLE', `The fleet did not take the notice to argo: ${told.error.message}`);
    }
    const declared = await deps.door.declareScopes(crew.crewToken, { namespace: PLUGIN_NAMESPACE, scopes: PLUGIN_SCOPES.map((each) => ({ ...each })) });
    if (!declared.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not take its namespace: ${declared.error.message}`);
    }
    return ok({ isDeclared: true });
  };
}
