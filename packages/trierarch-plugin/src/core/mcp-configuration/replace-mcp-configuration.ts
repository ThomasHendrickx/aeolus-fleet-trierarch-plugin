import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { replaceMcpConfiguration, type McpReplacement } from './mcp-configuration.js';
import type { McpActor, McpConfigurations } from './ports.js';

export type ReplaceMcpConfiguration = (request: { fleetId: FleetId; actor: McpActor; replacement: McpReplacement }) => Promise<Result<{ version: number }, DomainError<'VERSION_CONFLICT' | 'INVALID_CONFIGURATION'>>>;

/**
 * Use case: a manager replaces their fleet's MCP configuration whole (design
 * section 4): read the current set, replace it by the model's rules, then save
 * it with its value-free event, only while the version is still the one
 * read. A writer that lost to another of the same version is answered the
 * conflict, nothing written. Success means saved, not yet applied anywhere.
 */
export function createReplaceMcpConfiguration(deps: { configurations: McpConfigurations; clock: Clock }): ReplaceMcpConfiguration {
  return async ({ fleetId, actor, replacement }) => {
    const current = await deps.configurations.read(fleetId);
    const replaced = replaceMcpConfiguration({ fleetId, current }, replacement);
    if (!replaced.isOk) {
      return replaced;
    }
    const { configuration, changed } = replaced.value;
    const saved = await deps.configurations.replace(fleetId, {
      expectedVersion: current.version,
      configuration,
      event: { type: 'McpConfigurationReplaced', fleetId, version: configuration.version, actor, changed, at: deps.clock.now() },
    });
    if (saved === 'conflict') {
      return refuse('VERSION_CONFLICT', `The MCP configuration changed from version ${String(current.version)} meanwhile: read it again before replacing it`);
    }
    return ok({ version: configuration.version });
  };
}
