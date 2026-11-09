import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import { TRIERARCH_TYPE } from '../machines/join-machine.js';
import type { IdempotencyKeys } from '../machines/ports.js';
import { isSilent } from '../machines/silent.js';
import { readSealingKey } from './sealing-key.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { MCP_CONFIGURATION_CONTENT_TYPE, mcpConfigurationPayload, type McpConfiguration } from './mcp-configuration.js';
import { nextMcpSend, type McpAttempt } from './mcp-delivery.js';
import type { McpConfigurations, McpDeliveries, Sealer } from './ports.js';

export type DistributeMcpConfiguration = (fleetId: FleetId) => Promise<Result<{ sent: number; unsealable: { shipId: ShipId; publicKey: string }[] }, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusal that means no answer came: the pass stops, and the next one tries again. */
const UNAVAILABLE = 'UNAVAILABLE';

/**
 * Use case: one pass of reconciling a fleet's MCP configuration with its
 * trierarchs (the fleet crew MCP design, section 5). It reads the set once,
 * then every trierarch ship that is crewed and not silent and states a
 * sealing key: what `nextMcpSend` says it needs is sent as the plugin's ship,
 * the complete set at its version with every secret sealed to that key, an
 * empty set too. A new attempt is kept, under its new idempotency key, before
 * it is sent; one the fleet did not take is sent again, the same message
 * under the same key. A trierarch seen not crewed is forgotten, so its next
 * lease is sent the set again and confirms again. A trierarch without a key
 * is sent nothing, and so is one whose key the sealer refuses: it is named in
 * `unsealable`. A fleet that does not answer stops the pass; one that refuses
 * a send leaves that trierarch for the next pass.
 */
export function createDistributeMcpConfiguration(deps: {
  door: FleetDoor;
  connections: ConnectionStore;
  configurations: McpConfigurations;
  deliveries: McpDeliveries;
  sealer: Sealer;
  keys: IdempotencyKeys;
  clock: Clock;
  silentAfterMs: number;
}): DistributeMcpConfiguration {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer distributing the MCP configuration: ${refusal.message}`);

  /** The set's secrets each sealed to the key, or undefined when the sealer refuses the key. */
  const sealedTo = async (configuration: McpConfiguration, publicKey: string): Promise<{ name: string; sealed: string }[] | undefined> => {
    const secrets: { name: string; sealed: string }[] = [];
    for (const { name, value } of configuration.secrets) {
      const sealed = await deps.sealer.seal(value, publicKey);
      if (!sealed.isOk) {
        return undefined;
      }
      secrets.push({ name, sealed: sealed.value });
    }
    return secrets;
  };

  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const listed = await deps.door.listShips(crew.crewToken);
    if (!listed.isOk) {
      return unavailable(listed.error);
    }
    const now = deps.clock.now();
    const configuration = await deps.configurations.read(fleetId);
    const deliveries = new Map((await deps.deliveries.list(fleetId)).map((delivery) => [delivery.trierarchShipId, delivery]));
    const crewed = listed.value.filter((ship) => ship.type === TRIERARCH_TYPE && ship.status === 'crewed');
    const ended = [...deliveries.keys()].filter((shipId) => !crewed.some((ship) => ship.shipId === shipId));
    if (ended.length > 0) {
      await deps.deliveries.forget(fleetId, ended);
    }

    let sent = 0;
    const unsealable: { shipId: ShipId; publicKey: string }[] = [];
    for (const ship of crewed.filter((each) => !isSilent(each.lastSeenAt, { now, silentAfterMs: deps.silentAfterMs }))) {
      const read = await deps.door.getShip(crew.crewToken, { shipId: ship.shipId });
      if (!read.isOk && read.error.code === UNAVAILABLE) {
        return unavailable(read.error);
      }
      const publicKey = read.isOk ? readSealingKey(read.value.report?.details) : undefined;
      if (publicKey === undefined) {
        continue;
      }
      const next = nextMcpSend(deliveries.get(ship.shipId), { target: { version: configuration.version, publicKey }, now });
      if (next.kind === 'none') {
        continue;
      }
      let attempt: McpAttempt;
      if (next.kind === 'retry') {
        ({ attempt } = next);
      } else {
        const secrets = await sealedTo(configuration, publicKey);
        if (secrets === undefined) {
          unsealable.push({ shipId: ship.shipId, publicKey });
          continue;
        }
        const payload = mcpConfigurationPayload({ fleetId, pluginShipId: crew.shipId, version: configuration.version, publicKey, servers: configuration.servers, secrets });
        attempt = { version: configuration.version, publicKey, idempotencyKey: deps.keys.next(), payload, sentAt: null };
        // Kept before it is sent: a send the fleet may have taken is made again under this key, never under a new one.
        await deps.deliveries.recordAttempt(fleetId, { trierarchShipId: ship.shipId, attempt });
      }
      const done = await deps.door.send(crew.crewToken, { shipId: ship.shipId, contentType: MCP_CONFIGURATION_CONTENT_TYPE, payload: attempt.payload, idempotencyKey: attempt.idempotencyKey });
      if (!done.isOk && done.error.code === UNAVAILABLE) {
        return unavailable(done.error);
      }
      if (done.isOk) {
        await deps.deliveries.markSent(fleetId, { trierarchShipId: ship.shipId, idempotencyKey: attempt.idempotencyKey, at: now });
        sent += 1;
      }
    }
    return ok({ sent, unsealable });
  };
}
