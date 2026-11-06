import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import { TRIERARCH_TYPE } from '../machines/join-machine.js';
import type { IdempotencyKeys } from '../machines/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Sealer } from './ports.js';
import { readSealingKey } from './sealing-key.js';
import { SECRETS_CONTENT_TYPE, secretsPayload, type Secrets } from './secrets.js';

export type ShareSecrets = (fleetId: FleetId) => Promise<Result<{ shared: number; unsealable: { shipId: ShipId; publicKey: string }[] }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusal that means no answer came: the pass stops, and the next one tries again. */
const UNAVAILABLE = 'UNAVAILABLE';

/**
 * Use case: one pass of sharing the secret store with a fleet's trierarchs
 * (decision M5). Every trierarch ship that is not retired and whose report
 * states a sealing key gets the whole store, each value sealed to that key,
 * so the fleet stores only what it cannot read. `sealed` remembers, per
 * trierarch, the key this process last sealed the store to: a trierarch is
 * sent it again only when its report states another key, and a restart,
 * which may come with a changed store, sends it to every trierarch again
 * under a new idempotency key. An empty store is sent too, so a trierarch
 * forgets what left it. A trierarch without a key is sent nothing, and so is
 * one whose key the sealer refuses: it is named in `unsealable` with the key, the pass goes
 * on to the others, and the next pass tries it again. A send the fleet
 * refuses leaves that trierarch for the next pass.
 */
export function createShareSecrets(deps: {
  door: FleetDoor;
  connections: ConnectionStore;
  keys: IdempotencyKeys;
  secrets: Secrets;
  sealer: Sealer;
  sealed: Map<ShipId, string>;
}): ShareSecrets {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer sharing the secrets: ${refusal.message}`);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listShips(crew.crewToken);
    if (!listed.isOk) {
      return unavailable(listed.error);
    }
    let shared = 0;
    const unsealable: { shipId: ShipId; publicKey: string }[] = [];
    for (const ship of listed.value) {
      if (ship.type !== TRIERARCH_TYPE || ship.status === 'retired') {
        continue;
      }
      const read = await deps.door.getShip(crew.crewToken, { shipId: ship.shipId });
      if (!read.isOk && read.error.code === UNAVAILABLE) {
        return unavailable(read.error);
      }
      const publicKey = read.isOk ? readSealingKey(read.value.report?.details) : undefined;
      if (publicKey === undefined || deps.sealed.get(ship.shipId) === publicKey) {
        continue;
      }
      const secrets: { name: string; sealed: string }[] = [];
      for (const { name, value } of deps.secrets.secrets) {
        const sealed = await deps.sealer.seal(value, publicKey);
        if (!sealed.isOk) {
          break;
        }
        secrets.push({ name, sealed: sealed.value });
      }
      if (secrets.length < deps.secrets.secrets.length) {
        unsealable.push({ shipId: ship.shipId, publicKey });
        continue;
      }
      const sent = await deps.door.send(crew.crewToken, { shipId: ship.shipId, contentType: SECRETS_CONTENT_TYPE, payload: secretsPayload({ publicKey, secrets }), idempotencyKey: deps.keys.next() });
      if (!sent.isOk && sent.error.code === UNAVAILABLE) {
        return unavailable(sent.error);
      }
      if (sent.isOk) {
        deps.sealed.set(ship.shipId, publicKey);
        shared += 1;
      }
    }
    return ok({ shared, unsealable });
  };
}
