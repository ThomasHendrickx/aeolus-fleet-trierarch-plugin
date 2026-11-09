import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';
import type { McpChange, McpConfiguration } from './mcp-configuration.js';
import type { McpApplied, McpAttempt, McpDelivery } from './mcp-delivery.js';

/** Who replaced a set: the console session's kind and account, as `console.session` answers them; never a credential. */
export interface McpActor {
  readonly kind: string;
  readonly accountId: string | null;
}

/** The event of a replacement: its fleet, the version it saved, its actor and the names it changed, never a value. */
export interface McpConfigurationReplaced {
  readonly type: 'McpConfigurationReplaced';
  readonly fleetId: FleetId;
  readonly version: number;
  readonly actor: McpActor;
  readonly changed: McpChange;
  readonly at: Date;
}

/**
 * Outbound port: each fleet's one current MCP configuration (design section
 * 4), the plugin's credential store: readable to the service, never shown.
 */
export interface McpConfigurations {
  /** The fleet's current set; the empty one at version 0 before its first replacement. */
  read(fleetId: FleetId): Promise<McpConfiguration>;
  /**
   * Saves the set and its event in one unit of work, only while the fleet's
   * stored version is still `expectedVersion`: one of two writers of the same
   * version saves, the other is answered `conflict` with nothing written. A
   * failure saves neither and throws.
   */
  replace(fleetId: FleetId, replacement: { expectedVersion: number; configuration: McpConfiguration; event: McpConfigurationReplaced }): Promise<'replaced' | 'conflict'>;
}

/**
 * Outbound port: each fleet's deliveries of its MCP configuration, one per
 * trierarch ship, kept across restarts. Each change touches only its own
 * part, so a pass and the inbox round may change one delivery at once.
 */
export interface McpDeliveries {
  list(fleetId: FleetId): Promise<McpDelivery[]>;
  /** Keeps a new attempt, before it is sent: the trierarch's request, if any, is answered by it. */
  recordAttempt(fleetId: FleetId, recorded: { trierarchShipId: ShipId; attempt: McpAttempt }): Promise<void>;
  /** The fleet took the attempt under this key; a later attempt is left as it is. */
  markSent(fleetId: FleetId, sent: { trierarchShipId: ShipId; idempotencyKey: string; at: Date }): Promise<void>;
  recordApplied(fleetId: FleetId, recorded: { trierarchShipId: ShipId; applied: McpApplied }): Promise<void>;
  /** The trierarch asked for the set: the next pass sends it a new attempt. */
  markRequested(fleetId: FleetId, trierarchShipId: ShipId): Promise<void>;
  forget(fleetId: FleetId, trierarchShipIds: readonly ShipId[]): Promise<void>;
}

/**
 * Outbound port: seals a value to a trierarch's public key so that only the
 * holder of its private key opens it (decision M5): the NaCl anonymous sealed
 * box, the value as UTF-8, the public key (as `readSealingKey` read it) and
 * the sealed box as standard base64. A key no box can be sealed to, such as a
 * low-order point, is KEY_REFUSED.
 */
export interface Sealer {
  seal(value: string, publicKey: string): Promise<Result<string, { kind: 'KEY_REFUSED' }>>;
}
