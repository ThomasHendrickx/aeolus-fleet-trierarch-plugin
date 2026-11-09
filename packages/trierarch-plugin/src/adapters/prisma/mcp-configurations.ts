import { z } from 'zod';

import { EMPTY_MCP_CONFIGURATION, type McpServer } from '../../core/mcp-configuration/mcp-configuration.js';
import type { McpConfigurations } from '../../core/mcp-configuration/ports.js';
import type { PrismaClient } from './client.js';

/** The servers as the model saved them; a row read back is parsed, never trusted. */
const serversSchema = z.array(
  z.object({ name: z.string(), url: z.string(), tools: z.array(z.string()), credential: z.object({ secret: z.string(), header: z.string() }).optional() }),
);

/** Each server as saved: the credential only when the server has one. */
function serversOf(stored: unknown): McpServer[] {
  return serversSchema.parse(stored).map(({ name, url, tools, credential }) => (credential === undefined ? { name, url, tools } : { name, url, tools, credential }));
}

/**
 * Each fleet's MCP configuration: one row per fleet with its version and
 * servers, its secrets beside it, and an event row per replacement. A
 * replacement is one transaction that moves the version on only from the
 * version expected (an insert for the first, which a second writer's insert
 * of the same key cannot pass), so of two writers of one version one commits.
 */
export function createPrismaMcpConfigurations(db: PrismaClient): McpConfigurations {
  return {
    read: async (fleetId) => {
      const [row, secrets] = await Promise.all([
        db.mcpConfiguration.findUnique({ where: { fleetId }, select: { version: true, servers: true } }),
        db.mcpSecret.findMany({ where: { fleetId }, select: { name: true, value: true }, orderBy: { name: 'asc' } }),
      ]);
      return row === null ? EMPTY_MCP_CONFIGURATION : { version: row.version, servers: serversOf(row.servers), secrets };
    },
    replace: (fleetId, { expectedVersion, configuration, event }) =>
      db.$transaction(async (tx) => {
        const servers = configuration.servers.map(({ name, url, tools, credential }) => ({ name, url, tools: [...tools], ...(credential && { credential: { secret: credential.secret, header: credential.header } }) }));
        const moved =
          expectedVersion === 0
            ? await tx.mcpConfiguration.createMany({ data: [{ fleetId, version: configuration.version, servers, replacedAt: event.at }], skipDuplicates: true })
            : await tx.mcpConfiguration.updateMany({ where: { fleetId, version: expectedVersion }, data: { version: configuration.version, servers, replacedAt: event.at } });
        if (moved.count === 0) {
          return 'conflict';
        }
        await tx.mcpSecret.deleteMany({ where: { fleetId } });
        await tx.mcpSecret.createMany({ data: configuration.secrets.map(({ name, value }) => ({ fleetId, name, value })) });
        await tx.mcpConfigurationEvent.create({
          data: { fleetId, version: event.version, actorKind: event.actor.kind, actorAccountId: event.actor.accountId, changedServers: [...event.changed.servers], changedSecrets: [...event.changed.secrets], at: event.at },
        });
        return 'replaced';
      }),
  };
}
