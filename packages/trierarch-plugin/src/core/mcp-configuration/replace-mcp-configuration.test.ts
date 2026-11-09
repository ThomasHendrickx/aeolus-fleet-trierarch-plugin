import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/connection-fakes.js';
import { memoryMcpConfigurations } from '../../../test/support/memory-mcp-configurations.js';
import { createReadMcpConfiguration } from './read-mcp-configuration.js';
import { createReplaceMcpConfiguration } from './replace-mcp-configuration.js';

const AT = new Date('2026-11-09T12:00:00.000Z');
const MANAGER = { kind: 'operator', accountId: null };
const GRAPH = { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher'], credential: { secret: 'graph-token', header: 'Authorization' } };
/** A value no real credential looks like, searched for wherever anything is kept or answered. */
const VALUE = 'Bearer test-value-write-only-9a2c';

let configurations: ReturnType<typeof memoryMcpConfigurations>;
let replace: ReturnType<typeof createReplaceMcpConfiguration>;
let read: ReturnType<typeof createReadMcpConfiguration>;

beforeEach(() => {
  configurations = memoryMcpConfigurations();
  replace = createReplaceMcpConfiguration({ configurations, clock: { now: () => AT } });
  read = createReadMcpConfiguration({ configurations });
});

const withGraph = { expectedVersion: 0, servers: [GRAPH], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } };

describe("replacing a fleet's MCP configuration", () => {
  it('saves the whole set and answers its new version', async () => {
    await expect(replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: withGraph })).resolves.toEqual({ isOk: true, value: { version: 1 } });

    await expect(read(FLEET_ID)).resolves.toEqual({ version: 1, servers: [GRAPH], secrets: ['graph-token'] });
  });

  it('records one event with the actor, the version and the changed names, holding no value', async () => {
    await replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: withGraph });

    expect(configurations.events).toEqual([{ type: 'McpConfigurationReplaced', fleetId: FLEET_ID, version: 1, actor: MANAGER, changed: { servers: ['company-graph'], secrets: ['graph-token'] }, at: AT }]);
    expect(JSON.stringify(configurations.events)).not.toContain('test-value');
  });

  it('works on its own fleet only: another fleet reads its own empty set', async () => {
    await replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: withGraph });

    await expect(read(OTHER_FLEET_ID)).resolves.toEqual({ version: 0, servers: [], secrets: [] });
  });

  it('refuses a stale expected version without a write', async () => {
    await replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: withGraph });

    const replaced = await replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: { ...withGraph, servers: [] , secrets: [], secretValues: {} } });

    expect(replaced).toEqual({ isOk: false, error: { kind: 'VERSION_CONFLICT', message: 'The MCP configuration is at version 1, not 0: read it again before replacing it' } });
    expect(configurations.events).toHaveLength(1);
    await expect(read(FLEET_ID)).resolves.toMatchObject({ version: 1 });
  });

  it('refuses the loser of two replacements of the same version as a conflict, the winner kept', async () => {
    const first = replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: withGraph });
    const second = replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: { expectedVersion: 0, servers: [], secrets: [], secretValues: {} } });

    const outcomes = await Promise.all([first, second]);

    expect(outcomes.map((outcome) => (outcome.isOk ? 'saved' : outcome.error.kind))).toEqual(['saved', 'VERSION_CONFLICT']);
    expect(configurations.events).toHaveLength(1);
    await expect(read(FLEET_ID)).resolves.toEqual({ version: 1, servers: [GRAPH], secrets: ['graph-token'] });
  });

  it('refuses an invalid replacement without a write or an event', async () => {
    const replaced = await replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: { ...withGraph, secrets: [], secretValues: {} } });

    expect(replaced.isOk ? undefined : replaced.error.kind).toBe('INVALID_CONFIGURATION');
    expect(configurations.events).toEqual([]);
    await expect(read(FLEET_ID)).resolves.toEqual({ version: 0, servers: [], secrets: [] });
  });

  it('answers no success when the store fails, and leaves the set and its events as they were', async () => {
    configurations.isFailing = true;

    await expect(replace({ fleetId: FLEET_ID, actor: MANAGER, replacement: withGraph })).rejects.toThrow('the transaction rolled back');

    expect(configurations.events).toEqual([]);
    await expect(read(FLEET_ID)).resolves.toMatchObject({ version: 0 });
  });
});
