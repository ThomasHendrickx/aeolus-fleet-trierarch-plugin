import type { FleetId } from '@aeolus-fleet/common';

import { mcpConfigurationMetadata, type McpConfigurationMetadata } from './mcp-configuration.js';
import type { McpConfigurations } from './ports.js';

export type ReadMcpConfiguration = (fleetId: FleetId) => Promise<McpConfigurationMetadata>;

/** Use case: a fleet's MCP configuration as `mcp.get` answers it (design section 4): its version, servers and secret names, never a value. */
export function createReadMcpConfiguration(deps: { configurations: McpConfigurations }): ReadMcpConfiguration {
  return async (fleetId) => mcpConfigurationMetadata(await deps.configurations.read(fleetId));
}
