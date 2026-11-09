import type { FleetId } from '@aeolus-fleet/common';

import type { McpChange, McpConfiguration } from './mcp-configuration.js';

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
