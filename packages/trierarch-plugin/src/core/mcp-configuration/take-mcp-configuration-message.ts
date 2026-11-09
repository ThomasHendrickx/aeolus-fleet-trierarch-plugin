import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { PluginCrew, PluginDelivery } from '../connection/ports.js';
import { TRIERARCH_TYPE } from '../machines/join-machine.js';
import { MCP_CONFIGURATION_APPLIED_CONTENT_TYPE, MCP_CONFIGURATION_REQUEST_CONTENT_TYPE } from './mcp-configuration.js';
import type { McpConfigurations, McpDeliveries } from './ports.js';

/** What became of a delivery to the plugin's ship: not of the MCP configuration; a confirmation recorded; a request marked; or ignored, and why. */
export type TakenMcpMessage = { readonly kind: 'notMcpConfiguration' } | { readonly kind: 'applied' } | { readonly kind: 'requested' } | { readonly kind: 'ignored'; readonly reason: string };

export type TakeMcpConfigurationMessage = (crew: PluginCrew, delivery: PluginDelivery) => Promise<TakenMcpMessage>;

const appliedSchema = z.strictObject({ fleetId: idSchema('fleet'), pluginShipId: idSchema('ship'), version: z.int().nonnegative(), publicKey: z.string() });

const requestSchema = z.strictObject({ fleetId: idSchema('fleet'), pluginShipId: idSchema('ship') });

const OTHER_IDENTITY = 'it names another fleet or plugin ship';

/** Whether the payload names this fleet and this plugin ship, as the configured identity is. */
function isOwn(crew: PluginCrew, named: { fleetId: string; pluginShipId: string }): boolean {
  return named.fleetId === crew.fleetId && named.pluginShipId === crew.shipId;
}

/** The payload read by the schema, or undefined for text that is not JSON or does not fit it. */
function readPayload<T>(payload: string, schema: z.ZodType<T>): T | undefined {
  try {
    const read = schema.safeParse(JSON.parse(payload));
    return read.success ? read.data : undefined;
  } catch {
    // Not JSON: not a message of this contract.
    return undefined;
  }
}

/**
 * Use case: a trierarch's message about its fleet's MCP configuration to the
 * plugin's ship (the fleet crew MCP design, section 5). The fleet names the
 * sender and its status; the payload's identity must agree with this fleet
 * and this plugin ship, and never authorises itself. A confirmation counts
 * only from a crewed trierarch, for the fleet's current version and the key
 * its last attempt was sealed to: it is recorded against that trierarch. A
 * request, which a trierarch sends when its lease starts, forgets its
 * confirmation and marks it so the next pass sends it a new copy. Anything
 * else of the contract is ignored, recording nothing, with a reason that
 * holds no payload.
 */
export function createTakeMcpConfigurationMessage(deps: { configurations: McpConfigurations; deliveries: McpDeliveries }): TakeMcpConfigurationMessage {
  return async (crew, delivery) => {
    const isApplied = delivery.contentType === MCP_CONFIGURATION_APPLIED_CONTENT_TYPE;
    if (!isApplied && delivery.contentType !== MCP_CONFIGURATION_REQUEST_CONTENT_TYPE) {
      return { kind: 'notMcpConfiguration' };
    }
    if (delivery.senderType !== TRIERARCH_TYPE || delivery.senderStatus !== 'crewed') {
      return { kind: 'ignored', reason: 'its sender is not a crewed trierarch' };
    }
    if (!isApplied) {
      const request = readPayload(delivery.payload, requestSchema);
      if (request === undefined) {
        return { kind: 'ignored', reason: 'its payload is not { fleetId, pluginShipId }' };
      }
      if (!isOwn(crew, request)) {
        return { kind: 'ignored', reason: OTHER_IDENTITY };
      }
      await deps.deliveries.markRequested(crew.fleetId, delivery.senderShipId);
      return { kind: 'requested' };
    }
    const read = readPayload(delivery.payload, appliedSchema);
    if (read === undefined) {
      return { kind: 'ignored', reason: 'its payload is not { fleetId, pluginShipId, version, publicKey }' };
    }
    if (!isOwn(crew, read)) {
      return { kind: 'ignored', reason: OTHER_IDENTITY };
    }
    const { version } = await deps.configurations.read(crew.fleetId);
    if (read.version !== version) {
      return { kind: 'ignored', reason: `it confirms version ${String(read.version)}, not the current version ${String(version)}` };
    }
    const attempt = (await deps.deliveries.list(crew.fleetId)).find((each) => each.trierarchShipId === delivery.senderShipId)?.attempt;
    if (attempt?.version !== read.version || attempt.publicKey !== read.publicKey) {
      return { kind: 'ignored', reason: 'it confirms a version and key it was not sent' };
    }
    await deps.deliveries.recordApplied(crew.fleetId, { trierarchShipId: delivery.senderShipId, applied: { version: read.version, publicKey: read.publicKey } });
    return { kind: 'applied' };
  };
}
