import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaMcpConfigurations } from '../src/adapters/prisma/mcp-configurations.js';
import { createReadMcpConfiguration } from '../src/core/mcp-configuration/read-mcp-configuration.js';
import { createReplaceMcpConfiguration } from '../src/core/mcp-configuration/replace-mcp-configuration.js';
import { createPluginDatabase } from '../src/testing/database.js';

// Each fleet's MCP configuration in the trierarch plugin's own database (the
// fleet crew MCP design, sections 4 and 9): one set per fleet, its version
// guarding every replacement, saved with its value-free event in one
// transaction.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-11-09T12:00:00.000Z');
const MANAGER = { kind: 'operator', accountId: null };
const GRAPH = { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher'], credential: { secret: 'graph-token', header: 'Authorization' } };
/** A value no real credential looks like, searched for wherever the plugin keeps metadata or events. */
const VALUE = 'Bearer test-value-kept-only-in-secrets-4b7e';
const WITH_GRAPH = { expectedVersion: 0, servers: [GRAPH], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } };
const CLEARED = { expectedVersion: 0, servers: [], secrets: [], secretValues: {} };

let databaseUrl: string;
const clients: PrismaClient[] = [];

function aClient(): PrismaClient {
  const client = createPrismaClient(databaseUrl);
  clients.push(client);
  return client;
}

function useCases(db: PrismaClient) {
  const configurations = createPrismaMcpConfigurations(db);
  return { configurations, read: createReadMcpConfiguration({ configurations }), replace: createReplaceMcpConfiguration({ configurations, clock: { now: () => AT } }) };
}

beforeEach(async () => {
  databaseUrl = await createPluginDatabase();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
});

describe("a fleet's MCP configuration in Postgres", () => {
  it('keeps a saved set across a restart, its metadata holding no value', async () => {
    await useCases(aClient()).replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });

    const restarted = useCases(aClient());

    await expect(restarted.read(FLEET)).resolves.toEqual({ version: 1, servers: [GRAPH], secrets: ['graph-token'] });
    await expect(restarted.configurations.read(FLEET)).resolves.toEqual({ version: 1, servers: [GRAPH], secrets: [{ name: 'graph-token', value: VALUE }] });
  });

  it('keeps each fleet apart: another fleet reads version 0 with nothing', async () => {
    const { read, replace } = useCases(aClient());
    await replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });

    await expect(read(OTHER)).resolves.toEqual({ version: 0, servers: [], secrets: [] });
  });

  it('keeps values out of the set row and the events', async () => {
    const db = aClient();
    await useCases(db).replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });

    const rows = await db.$queryRaw<{ row: string }[]>`SELECT row_to_json(c)::text AS row FROM mcp_configurations c UNION ALL SELECT row_to_json(e)::text FROM mcp_configuration_events e`;

    expect(rows).toHaveLength(2);
    expect(rows.map((each) => each.row).join('\n')).not.toContain('test-value');
  });

  it('records the event of each replacement with its version, actor and changed names', async () => {
    const db = aClient();
    const { replace } = useCases(db);
    await replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });
    await replace({ fleetId: FLEET, actor: { kind: 'account', accountId: 'acc_test' }, replacement: { ...CLEARED, expectedVersion: 1 } });

    await expect(db.$queryRaw`SELECT fleet_id, version, actor_kind, actor_account_id, changed_servers, changed_secrets, at FROM mcp_configuration_events ORDER BY version`).resolves.toEqual([
      { fleet_id: FLEET, version: 1, actor_kind: 'operator', actor_account_id: null, changed_servers: ['company-graph'], changed_secrets: ['graph-token'], at: AT },
      { fleet_id: FLEET, version: 2, actor_kind: 'account', actor_account_id: 'acc_test', changed_servers: ['company-graph'], changed_secrets: ['graph-token'], at: AT },
    ]);
  });

  it('commits exactly one of two writers replacing the first version at once, each on its own connection', async () => {
    const first = useCases(aClient());
    const second = useCases(aClient());

    const outcomes = await Promise.all([first.replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH }), second.replace({ fleetId: FLEET, actor: MANAGER, replacement: CLEARED })]);

    expect(outcomes.filter((outcome) => outcome.isOk)).toEqual([{ isOk: true, value: { version: 1 } }]);
    expect(outcomes.flatMap((outcome) => (outcome.isOk ? [] : [outcome.error.kind]))).toEqual(['VERSION_CONFLICT']);
    await expect(aClient().mcpConfigurationEvent.count()).resolves.toBe(1);
  });

  it('commits exactly one of five writers replacing a later version at once', async () => {
    await useCases(aClient()).replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });
    const writers = Array.from({ length: 5 }, () => useCases(aClient()));

    const outcomes = await Promise.all(writers.map((writer) => writer.replace({ fleetId: FLEET, actor: MANAGER, replacement: { ...WITH_GRAPH, expectedVersion: 1 } })));

    expect(outcomes.filter((outcome) => outcome.isOk)).toEqual([{ isOk: true, value: { version: 2 } }]);
    await expect(useCases(aClient()).read(FLEET)).resolves.toMatchObject({ version: 2 });
    await expect(aClient().mcpConfigurationEvent.count()).resolves.toBe(2);
  });

  it('reads a version with its own secrets while a replacement commits between the read of the set and of its secrets', async () => {
    await useCases(aClient()).replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });
    const reader = createPrismaMcpConfigurations(aClient());
    const watcher = aClient();
    const NEXT_VALUE = 'Bearer test-value-of-version-2-9c1d';
    let read: ReturnType<typeof reader.read> | undefined;

    // The replacement holds the secrets table until it commits: the reader sees the set row as it was, then waits for the secrets.
    await aClient().$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('LOCK TABLE mcp_secrets IN ACCESS EXCLUSIVE MODE');
        await tx.mcpConfiguration.update({ where: { fleetId: FLEET }, data: { version: 2 } });
        read = reader.read(FLEET);
        await expect.poll(async () => (await watcher.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%mcp_secrets%'`)[0]?.count).toBe(1n);
        await tx.mcpSecret.update({ where: { fleetId_name: { fleetId: FLEET, name: 'graph-token' } }, data: { value: NEXT_VALUE } });
      },
      { timeout: 20_000 },
    );

    const { version, secrets } = await (read ?? Promise.reject(new Error('the read never started')));
    expect([version, secrets]).toBeOneOf([
      [1, [{ name: 'graph-token', value: VALUE }]],
      [2, [{ name: 'graph-token', value: NEXT_VALUE }]],
    ]);
  });

  it('changes neither the set, its secrets, its version nor its events when the transaction fails', async () => {
    const db = aClient();
    const { configurations, replace } = useCases(db);
    await replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });
    // The event's insert fails last in the transaction, as a lost database would mid-way.
    await db.$executeRawUnsafe(`CREATE FUNCTION refuse_event() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe('CREATE TRIGGER refuse_event BEFORE INSERT ON mcp_configuration_events FOR EACH ROW EXECUTE FUNCTION refuse_event()');

    await expect(replace({ fleetId: FLEET, actor: MANAGER, replacement: { ...CLEARED, expectedVersion: 1 } })).rejects.toThrow();

    await expect(configurations.read(FLEET)).resolves.toEqual({ version: 1, servers: [GRAPH], secrets: [{ name: 'graph-token', value: VALUE }] });
    await expect(db.mcpConfigurationEvent.count()).resolves.toBe(1);
  });

  it("forgets a fleet's set, secrets and events with the fleet, keeping another fleet's", async () => {
    const db = aClient();
    const { configurations, replace } = useCases(db);
    await replace({ fleetId: FLEET, actor: MANAGER, replacement: WITH_GRAPH });
    await replace({ fleetId: OTHER, actor: MANAGER, replacement: WITH_GRAPH });

    await createPrismaFleetForgetter(db).forget(FLEET);

    await expect(configurations.read(FLEET)).resolves.toEqual({ version: 0, servers: [], secrets: [] });
    await expect(db.mcpConfigurationEvent.count({ where: { fleetId: FLEET } })).resolves.toBe(0);
    await expect(configurations.read(OTHER)).resolves.toMatchObject({ version: 1 });
  });
});
