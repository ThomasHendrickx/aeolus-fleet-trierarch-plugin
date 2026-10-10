import { ANY_LABEL_VALUE, type FleetId, type LabelId, type ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { TRIERARCH_LABEL } from '../machines/label-machines.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** Whether this pass declared to the fleet: false when it holds its declaration already or has nothing to declare yet. */
export type DeclareNetworkRules = (fleetId: FleetId) => Promise<Result<{ isDeclared: boolean }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * What this process declared, per ship of the trierarch plugin: the trierarch
 * label its rules name, or null once it withdrew them. Every declaration
 * writes an event the networking plugin supplies the fleet again on, so the
 * trierarch plugin declares only what it did not declare already.
 */
export type Declarations = Map<ShipId, LabelId | null>;

/**
 * Use case: the trierarch plugin declares the network rules its ships need
 * (#573, decision 0037): every trierarch ship reaches every other,
 * `trierarch=*` to `trierarch=*`, on the trierarch label it owns. Nothing to
 * declare while the fleet has no trierarch label of its own: the machine
 * labels pass defines it, and a key another ship owns is not its to use.
 * Declared once per ship and label in this process; a fleet that did not
 * answer is declared on the next pass.
 */
export function createDeclareNetworkRules(deps: { door: FleetDoor; connections: ConnectionStore; declarations: Declarations }): DeclareNetworkRules {
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listLabels(crew.crewToken);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer its network rules: ${listed.error.message}`);
    }
    const label = listed.value.find((each) => each.key === TRIERARCH_LABEL.key && each.ownerShipId === crew.shipId);
    if (label === undefined || deps.declarations.get(crew.shipId) === label.labelId) {
      return ok({ isDeclared: false });
    }
    const term = { labelId: label.labelId, value: ANY_LABEL_VALUE };
    const declared = await deps.door.declareNetworkRules(crew.crewToken, { rules: [{ from: [term], to: [term] }] });
    if (!declared.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not take its network rules: ${declared.error.message}`);
    }
    deps.declarations.set(crew.shipId, label.labelId);
    return ok({ isDeclared: true });
  };
}
