import type { FleetId } from '@aeolus-fleet/common';

import { EMPTY_MCP_CONFIGURATION, type McpConfiguration } from '../../src/core/mcp-configuration/mcp-configuration.js';
import type { McpConfigurationReplaced, McpConfigurations } from '../../src/core/mcp-configuration/ports.js';

/**
 * Each fleet's MCP configuration in memory, with the events of its
 * replacements: a replacement is saved with its event only while the held
 * version is the one it expects. Set `isFailing` to fail every replacement
 * as a transaction that rolls back would, saving nothing.
 */
export function memoryMcpConfigurations(): McpConfigurations & { held: Map<FleetId, McpConfiguration>; events: McpConfigurationReplaced[]; isFailing: boolean } {
  const held = new Map<FleetId, McpConfiguration>();
  const events: McpConfigurationReplaced[] = [];
  const store = {
    held,
    events,
    isFailing: false,
    read: (fleetId: FleetId) => Promise.resolve(held.get(fleetId) ?? EMPTY_MCP_CONFIGURATION),
    replace: (fleetId: FleetId, replacement: { expectedVersion: number; configuration: McpConfiguration; event: McpConfigurationReplaced }) => {
      if (store.isFailing) {
        return Promise.reject(new Error('the transaction rolled back'));
      }
      if ((held.get(fleetId) ?? EMPTY_MCP_CONFIGURATION).version !== replacement.expectedVersion) {
        return Promise.resolve('conflict' as const);
      }
      held.set(fleetId, replacement.configuration);
      events.push(replacement.event);
      return Promise.resolve('replaced' as const);
    },
  };
  return store;
}
