import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryMcpConfigurations } from '../../../test/support/memory-mcp-configurations.js';
import { createReadMcpConfiguration } from './read-mcp-configuration.js';
import { createReplaceMcpConfiguration } from './replace-mcp-configuration.js';

const GRAPH = { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher'], credential: { secret: 'graph-token', header: 'Authorization' } };
/** A value no real credential looks like, searched for in what a read answers. */
const VALUE = 'Bearer test-value-write-only-9a2c';
const withGraph = { expectedVersion: 0, servers: [GRAPH], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } };

let configurations: ReturnType<typeof memoryMcpConfigurations>;
let read: ReturnType<typeof createReadMcpConfiguration>;
let replace: ReturnType<typeof createReplaceMcpConfiguration>;

beforeEach(() => {
  configurations = memoryMcpConfigurations();
  read = createReadMcpConfiguration({ configurations });
  replace = createReplaceMcpConfiguration({ configurations, clock: { now: () => new Date('2026-11-09T12:00:00.000Z') } });
});

describe("reading a fleet's MCP configuration", () => {
  it('answers version 0 with no servers and no secrets before the first replacement', async () => {
    await expect(read(FLEET_ID)).resolves.toEqual({ version: 0, servers: [], secrets: [] });
  });

  it('answers the secrets by name only, never a value', async () => {
    await replace({ fleetId: FLEET_ID, actor: { kind: 'operator', accountId: null }, replacement: withGraph });

    expect(JSON.stringify(await read(FLEET_ID))).not.toContain('test-value');
  });
});
