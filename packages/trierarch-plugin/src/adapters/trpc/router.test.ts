import { EMPTY_GUARD_CONFIGURATION } from '../../core/guard/guard-configuration.js';
import { createManageGuardConfiguration } from '../../core/guard/manage-guard-configuration.js';
import type { FleetId, ScopeName, ShipId } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { memoryMcpConfigurations } from '../../../test/support/memory-mcp-configurations.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import { cannedUsageHistory } from '../../../test/support/memory-usage.js';
import { createJoinMachine } from '../../core/machines/join-machine.js';
import { createReadMcpConfiguration } from '../../core/mcp-configuration/read-mcp-configuration.js';
import { createReplaceMcpConfiguration } from '../../core/mcp-configuration/replace-mcp-configuration.js';
import { createListEnabledModels } from '../../core/models/list-enabled-models.js';
import { createSetModelEnabled } from '../../core/models/set-model-enabled.js';
import { createReadTokenUsage } from '../../core/usage/read-token-usage.js';
import { createReadSubscriptionWindows } from '../../core/usage/read-subscription-windows.js';
import { createReadUsageValues } from '../../core/usage/read-usage-values.js';
import type { TokenUsage } from '../../core/usage/token-usage.js';
import { ok } from '../../core/shared/result.js';
import { joinMachineInputSchema, trierarchPluginRouter, type Context } from './router.js';

// The models procedures (model governance, M6): reading the fleet's enabled
// models is every signed-in session's, viewer included; enabling and disabling
// take fleet:manage. Each needs the trierarch plugin to serve the fleet and be
// connected to it. Reading usage (the usage design) is every signed-in
// session's too. A fleet's MCP configuration (the fleet crew MCP design,
// section 4) is read and replaced with fleet:manage, a replacement only with
// the console's Origin.

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPERATOR: readonly ScopeName[] = ['fleet:read', 'fleet:manage'];
const VIEWER: readonly ScopeName[] = ['fleet:read'];

/** Procedures these tests never reach. */
const notReached = () => Promise.reject(new Error('not reached by the models procedures'));

const NINE = new Date('2026-10-28T09:00:00.000Z');

/** The console's origin, as the configuration holds it. */
const CONSOLE_ORIGIN = 'https://console.example.com';

/** One hour of Opus usage, as the history answers it. */
const OPUS_HOUR: TokenUsage = {
  series: [{ kind: 'value', value: OPUS }],
  buckets: [
    {
      at: NINE,
      amounts: [
        {
          series: 0,
          tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 },
          estimatedCostUsd: { input: 0.5, output: 0.5, cacheRead: 0.25, cacheWrite: 0.25 },
          unpricedTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  ],
  unpricedModels: ['gpt-6-sol'],
};

/** 21 models with usage, model-01 with the most tokens: one more than a page. */
const MODELS = Array.from({ length: 21 }, (_, index) => ({ value: `model-${String(index + 1).padStart(2, '0')}`, tokens: 1000 - index }));

const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3c';

/** The five hour window of Claude Code on one machine, read once. */
const MAC_WINDOWS = {
  machineShipId: MAC,
  harness: 'claude-code',
  windows: [{ windowMinutes: 300, readings: [{ readAt: NINE, usedPercent: 42, resetsAt: new Date('2026-10-28T12:00:00.000Z') }] }],
};

let models: ReturnType<typeof memoryEnabledModels>;
let mcpConfigurations: ReturnType<typeof memoryMcpConfigurations>;
let windowsFleet: ReturnType<typeof fakePluginFleet>;
let windowsConnections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  models = memoryEnabledModels();
  mcpConfigurations = memoryMcpConfigurations();
  windowsFleet = fakePluginFleet();
  windowsConnections = memoryConnectionStore();
  windowsFleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await windowsConnections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: NINE });
  windowsFleet.state.ships.push({ shipId: MAC, name: 'trierarch-mac', type: 'trierarch', status: 'crewed', lastSeenAt: NINE, model: null, crewRequest: null, labels: [] });
});

/** The router as the console's server calls it, for a session of the given scopes, on a fleet served and connected unless it says otherwise. */
function caller(session: { kind?: 'operator' | 'viewer'; scopes: readonly ScopeName[]; isServed?: boolean; isConnected?: boolean; origin?: string; joinMachine?: Context['joinMachine'] }) {
  let configuration = EMPTY_GUARD_CONFIGURATION;
  const guard = createManageGuardConfiguration({
    configurations: {
      readConfiguration: () => Promise.resolve(configuration),
      replace: (_fleetId, input) => {
        configuration = input.configuration;
        return Promise.resolve('replaced');
      },
    },
    clock: { now: () => NINE },
    refresh: (_fleetId, current) => Promise.resolve({
      catalogue: { ...current, repositories: current.repositories.map((repository) => ({ ...repository, readCommit: null })), sets: [], errors: [], conflicts: [] },
      definitions: [],
      isReadFailed: false,
    }),
  });
  const context: Context = {
    cookie: 'aeolus_session=a-session',
    origin: session.origin,
    consoleOrigin: CONSOLE_ORIGIN,
    authenticateOperator: () => Promise.resolve(ok({ fleetId: FLEET_ID, kind: session.kind ?? 'operator', scopes: session.scopes })),
    isConnected: (fleetId: FleetId) => Promise.resolve(fleetId === FLEET_ID && (session.isConnected ?? true)),
    isServed: (fleetId: FleetId) => Promise.resolve(fleetId === FLEET_ID && (session.isServed ?? true)),
    heldConnection: notReached,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    installationConnect: notReached,
    setFleetEnabled: notReached,
    readFleet: notReached,
    deleteFleet: notReached,
    readConnection: notReached,
    connect: notReached,
    joinMachine: session.joinMachine ?? notReached,
    newSetupLine: notReached,
    listMachines: notReached,
    checkCrewSettings: notReached,
    listEnabledModels: createListEnabledModels({ models }),
    setModelEnabled: createSetModelEnabled({ models }),
    guard,
    readMcpConfiguration: createReadMcpConfiguration({ configurations: mcpConfigurations }),
    replaceMcpConfiguration: createReplaceMcpConfiguration({ configurations: mcpConfigurations, clock: { now: () => NINE } }),
    readTokenUsage: createReadTokenUsage({ usage: cannedUsageHistory({ usage: OPUS_HOUR }), door: fakePluginFleet().door, connections: memoryConnectionStore() }),
    readUsageValues: createReadUsageValues({ usage: cannedUsageHistory({ values: MODELS }), door: fakePluginFleet().door, connections: memoryConnectionStore() }),
    readSubscriptionWindows: createReadSubscriptionWindows({ usage: cannedUsageHistory({ windows: [MAC_WINDOWS] }), door: windowsFleet.door, connections: windowsConnections }),
  };
  return trierarchPluginRouter.createCaller(context);
}

/** The tRPC code a call is refused with. */
async function refusalOf(call: Promise<unknown>): Promise<string> {
  const error: unknown = await call.then(
    () => undefined,
    (refused: unknown) => refused,
  );
  return error instanceof TRPCError ? error.code : 'NOT_REFUSED';
}

describe("the fleet's enabled models over the API (model governance, M6)", () => {
  it("answers the fleet's enabled models by id to a viewer too", async () => {
    await models.enable(FLEET_ID, SONNET);
    await models.enable(FLEET_ID, OPUS);

    await expect(caller({ kind: 'viewer', scopes: VIEWER }).models.list()).resolves.toEqual([OPUS, SONNET]);
  });

  it("enables a model for an operator and answers the fleet's set", async () => {
    await expect(caller({ scopes: OPERATOR }).models.enable({ model: OPUS })).resolves.toEqual([OPUS]);
  });

  it("disables a model for an operator and answers the fleet's set", async () => {
    await models.enable(FLEET_ID, OPUS);
    await models.enable(FLEET_ID, SONNET);

    await expect(caller({ scopes: OPERATOR }).models.disable({ model: OPUS })).resolves.toEqual([SONNET]);
  });

  it('refuses a viewer enabling or disabling a model, storing nothing: FORBIDDEN', async () => {
    await models.enable(FLEET_ID, OPUS);
    const viewer = caller({ kind: 'viewer', scopes: VIEWER });

    await expect(refusalOf(viewer.models.enable({ model: SONNET }))).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(viewer.models.disable({ model: OPUS }))).resolves.toBe('FORBIDDEN');
    expect(models.held.get(FLEET_ID)).toEqual([OPUS]);
  });

  it('refuses a model id common does not take as a model, storing nothing: BAD_REQUEST', async () => {
    await expect(refusalOf(caller({ scopes: OPERATOR }).models.enable({ model: 'claude opus' }))).resolves.toBe('BAD_REQUEST');
    expect(models.held.get(FLEET_ID)).toBeUndefined();
  });

  it('refuses every models procedure while the trierarch plugin is off for the fleet: FORBIDDEN', async () => {
    const off = caller({ scopes: OPERATOR, isServed: false });

    await expect(refusalOf(off.models.list())).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(off.models.enable({ model: OPUS }))).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(off.models.disable({ model: OPUS }))).resolves.toBe('FORBIDDEN');
    expect(models.held.get(FLEET_ID)).toBeUndefined();
  });

  it('refuses every models procedure while the trierarch plugin is not connected to the fleet: PRECONDITION_FAILED', async () => {
    const notConnected = caller({ scopes: OPERATOR, isConnected: false });

    await expect(refusalOf(notConnected.models.list())).resolves.toBe('PRECONDITION_FAILED');
    await expect(refusalOf(notConnected.models.enable({ model: OPUS }))).resolves.toBe('PRECONDITION_FAILED');
    await expect(refusalOf(notConnected.models.disable({ model: OPUS }))).resolves.toBe('PRECONDITION_FAILED');
    expect(models.held.get(FLEET_ID)).toBeUndefined();
  });
});

describe("the fleet's token usage over the API (the usage design)", () => {
  const range = { from: '2026-10-28T09:00:00.000Z', to: '2026-10-29T09:00:00.000Z' };

  it('answers a viewer the usage in the range, times in ISO 8601 UTC', async () => {
    const usage = caller({ kind: 'viewer', scopes: VIEWER }).usage.tokens({ ...range, splitBy: 'model', measure: 'tokens', filters: {} });

    await expect(usage).resolves.toEqual({
      grain: 'hour',
      series: [{ key: { kind: 'value', value: OPUS }, name: OPUS, amounts: { tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 }, estimatedCostUsd: 1.5, unpricedTokens: 0 } }],
      buckets: [{ at: '2026-10-28T09:00:00.000Z', amounts: [{ series: 0, tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 }, estimatedCostUsd: 1.5, unpricedTokens: 0 }] }],
      totals: { tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 }, estimatedCostUsd: 1.5, unpricedTokens: 0 },
      unpricedModels: ['gpt-6-sol'],
    });
  });

  it('refuses a range that does not start on a whole hour: BAD_REQUEST', async () => {
    const usage = caller({ scopes: OPERATOR }).usage.tokens({ from: '2026-10-28T09:30:00.000Z', to: range.to, splitBy: null, measure: 'tokens', filters: {} });

    await expect(refusalOf(usage)).resolves.toBe('BAD_REQUEST');
  });

  it('refuses a split it does not know: BAD_REQUEST', async () => {
    // @ts-expect-error: a split the input does not take, as a caller outside TypeScript may send it
    const usage = caller({ scopes: OPERATOR }).usage.tokens({ ...range, splitBy: 'colour', measure: 'tokens', filters: {} });

    await expect(refusalOf(usage)).resolves.toBe('BAD_REQUEST');
  });

  it('refuses reading usage while the trierarch plugin is off for the fleet: FORBIDDEN', async () => {
    const usage = caller({ scopes: OPERATOR, isServed: false }).usage.tokens({ ...range, splitBy: null, measure: 'tokens', filters: {} });

    await expect(refusalOf(usage)).resolves.toBe('FORBIDDEN');
  });
});

describe("the values of one breakdown of the fleet's usage over the API (the usage design)", () => {
  const range = { from: '2026-10-28T09:00:00.000Z', to: '2026-10-29T09:00:00.000Z' };

  it('answers a viewer a page of values, and the next page for its cursor', async () => {
    const viewer = caller({ kind: 'viewer', scopes: VIEWER });

    const first = await viewer.usage.values({ ...range, breakdown: 'model', cursor: null });
    const next = await viewer.usage.values({ ...range, breakdown: 'model', cursor: first.nextCursor });

    expect(first.values).toHaveLength(20);
    expect(first.values[0]).toEqual({ value: 'model-01', name: 'model-01', tokens: 1000 });
    expect(next).toEqual({ values: [{ value: 'model-21', name: 'model-21', tokens: 980 }], nextCursor: null });
  });

  it('refuses a cursor it did not give: BAD_REQUEST', async () => {
    const values = caller({ scopes: OPERATOR }).usage.values({ ...range, breakdown: 'model', cursor: 'not-a-cursor' });

    await expect(refusalOf(values)).resolves.toBe('BAD_REQUEST');
  });
});

describe("the subscription windows of the fleet's machines over the API (the usage design)", () => {
  const range = { from: '2026-10-28T09:00:00.000Z', to: '2026-10-29T09:00:00.000Z' };

  it('answers a viewer each machine and harness with its windows, the machine named, times in ISO 8601 UTC', async () => {
    const windows = caller({ kind: 'viewer', scopes: VIEWER }).usage.windows({ ...range, filters: {}, cursor: null });

    await expect(windows).resolves.toEqual({
      charts: [
        {
          machineShipId: MAC,
          machineName: 'trierarch-mac',
          harness: 'claude-code',
          windows: [{ windowMinutes: 300, readings: [{ readAt: '2026-10-28T09:00:00.000Z', usedPercent: 42, resetsAt: '2026-10-28T12:00:00.000Z' }] }],
        },
      ],
      nextCursor: null,
    });
  });

  it('refuses a cursor it did not give: BAD_REQUEST', async () => {
    const windows = caller({ scopes: OPERATOR }).usage.windows({ ...range, filters: {}, cursor: 'not-a-cursor' });

    await expect(refusalOf(windows)).resolves.toBe('BAD_REQUEST');
  });
});

describe("a fleet's MCP configuration over the API (the fleet crew MCP design, section 4)", () => {
  const GRAPH = { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher'], credential: { secret: 'graph-token', header: 'Authorization' } };
  /** A value no real credential looks like, searched for in every answer. */
  const VALUE = 'Bearer test-value-api-entry-3e8f';
  const WITH_GRAPH = { expectedVersion: 0, servers: [GRAPH], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } };
  const manager = () => caller({ scopes: OPERATOR, origin: CONSOLE_ORIGIN });

  it('answers version 0 with no servers and no secrets before the first replacement', async () => {
    await expect(manager().mcp.get()).resolves.toEqual({ version: 0, servers: [], secrets: [] });
  });

  it('replaces the set with the console Origin and answers the version; a read answers secret names only', async () => {
    await expect(manager().mcp.replace(WITH_GRAPH)).resolves.toEqual({ version: 1 });

    const read = await manager().mcp.get();
    expect(read).toEqual({ version: 1, servers: [GRAPH], secrets: ['graph-token'] });
    expect(JSON.stringify(read)).not.toContain('test-value');
  });

  it('refuses a viewer holding only fleet:read both the read and the replacement', async () => {
    const viewer = caller({ kind: 'viewer', scopes: VIEWER, origin: CONSOLE_ORIGIN });

    await expect(refusalOf(viewer.mcp.get())).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(viewer.mcp.replace(WITH_GRAPH))).resolves.toBe('FORBIDDEN');
    expect(mcpConfigurations.events).toEqual([]);
  });

  it.each([
    { label: 'no Origin', origin: undefined },
    { label: 'another Origin', origin: 'https://elsewhere.example.com' },
    { label: 'the Origin with a path', origin: `${CONSOLE_ORIGIN}/` },
  ])('refuses a replacement with $label before any write', async ({ origin }) => {
    await expect(refusalOf(caller({ scopes: OPERATOR, origin }).mcp.replace(WITH_GRAPH))).resolves.toBe('FORBIDDEN');

    expect(mcpConfigurations.events).toEqual([]);
    await expect(manager().mcp.get()).resolves.toMatchObject({ version: 0 });
  });

  it('refuses both while the trierarch plugin is off for the fleet', async () => {
    const off = caller({ scopes: OPERATOR, origin: CONSOLE_ORIGIN, isServed: false });

    await expect(refusalOf(off.mcp.get())).resolves.toBe('FORBIDDEN');
    await expect(refusalOf(off.mcp.replace(WITH_GRAPH))).resolves.toBe('FORBIDDEN');
  });

  it('refuses a stale expected version as CONFLICT', async () => {
    await manager().mcp.replace(WITH_GRAPH);

    await expect(refusalOf(manager().mcp.replace(WITH_GRAPH))).resolves.toBe('CONFLICT');
  });

  it('refuses an invalid replacement as BAD_REQUEST, its message holding no value', async () => {
    const refused: unknown = await manager()
      .mcp.replace({ ...WITH_GRAPH, servers: [{ ...GRAPH, url: 'https://me:secret@graph.example.invalid/mcp' }] })
      .catch((error: unknown) => error);

    expect(refused instanceof TRPCError && refused.code).toBe('BAD_REQUEST');
    expect(refused instanceof TRPCError && refused.message).toMatch(/^company-graph: an MCP server is an http/);
    expect(JSON.stringify(refused)).not.toContain('test-value');
  });

  it('answers an internal error with no value when the store fails', async () => {
    mcpConfigurations.isFailing = true;

    const refused: unknown = await manager().mcp.replace(WITH_GRAPH).catch((error: unknown) => error);

    expect(refused instanceof TRPCError && refused.code).toBe('INTERNAL_SERVER_ERROR');
    expect(refused instanceof TRPCError && refused.cause).toBeUndefined();
  });
});

describe('the options of a join over the API (join design, decision 12)', () => {
  it('accepts service consent, folders and limits, refusing invalid flag inputs', () => {
    expect(joinMachineInputSchema.safeParse({ name: 'mac', service: 'yes', maxShips: 4, maxRunning: 2, folders: { kind: 'list', entries: [{ name: 'shared', path: '/srv/shared' }] } }).success).toBe(true);
    expect(joinMachineInputSchema.safeParse({ name: 'mac', service: 'no', folders: { kind: 'none' } }).success).toBe(true);
    for (const options of [{ service: 'maybe' }, { maxShips: 0 }, { maxRunning: 1.5 }, { folders: { kind: 'list', entries: [{ name: 'shared', path: '' }] } }]) {
      expect(joinMachineInputSchema.safeParse({ name: 'mac', ...options }).success).toBe(false);
    }
  });

  const parsed = (input: unknown) => joinMachineInputSchema.safeParse(input).success;

  it('takes a name alone, or with harnesses, the ones run without asking, and repositories as a list, a folder or none', () => {
    expect(parsed({ name: 'mac' })).toBe(true);
    expect(parsed({ name: 'mac', harnesses: ['claude-code', 'codex', 'copilot'], unattended: ['codex'], repositories: { kind: 'list', entries: ['~/a', '', 'https://h/x.git'] } })).toBe(true);
    expect(parsed({ name: 'mac', repositories: { kind: 'folder', path: '~/code' } })).toBe(true);
    expect(parsed({ name: 'mac', repositories: { kind: 'none' } })).toBe(true);
    expect(parsed({ name: 'mac', repositories: { kind: 'folder', path: '/a,b;c' } })).toBe(true);
  });

  it.each([
    ['a harness without an adapter', { name: 'mac', harnesses: ['cursor'] }],
    ['a clone folder', { name: 'mac', cloneInto: '/x' }],
    ['an empty folder', { name: 'mac', repositories: { kind: 'folder', path: '' } }],
  ])('refuses %s', (_what, input) => {
    expect(parsed(input)).toBe(false);
  });
});

describe('the repositories of a join, through the real use case', () => {
  async function joinCaller() {
    const fleet = fakePluginFleet();
    const connections = memoryConnectionStore();
    fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: new Date('2026-10-06T22:00:00.000Z') });
    const joinMachine = createJoinMachine({ door: fleet.door, connections, keys: { next: () => 'join-key' }, fleetUrl: 'https://fleet.example' });
    return { fleet, caller: caller({ scopes: OPERATOR, joinMachine }) };
  }


  it('refuses invalid folder choices before commissioning a ship', async () => {
    const { fleet, caller: api } = await joinCaller();
    for (const entries of [[{ name: 'Shared', path: '/a' }], [{ name: 'shared', path: '/a' }, { name: 'shared', path: '/b' }], [{ name: 'shared', path: '/a\0b' }]]) {
      await expect(refusalOf(api.machines.join({ name: 'mac', folders: { kind: 'list', entries } }))).resolves.toBe('BAD_REQUEST');
    }
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('forwards service, folders and limits through the join API into the generated setup line', async () => {
    const { caller: api } = await joinCaller();
    const joined = await api.machines.join({ name: 'mac', service: 'yes', maxShips: 4, maxRunning: 2, folders: { kind: 'list', entries: [{ name: 'shared', path: '/srv/shared' }] } });
    expect(joined.setupLine.includes(" --folder 'shared' '/srv/shared' --max-ships 4 --max-running 2 --service yes")).toBe(true);
  });

  it('answers a hostile folder path with a semicolon and quotes as one quoted word, written out literally', async () => {
    const { caller: api } = await joinCaller();

    const joined = await api.machines.join({ name: 'mac', repositories: { kind: 'folder', path: `/x'; rm -rf ~ #"` } });

    expect(joined.setupLine.includes(` --repositories-in '/x'\\''; rm -rf ~ #"'`)).toBe(true);
  });

  it('answers a folder path holding a comma and a semicolon', async () => {
    const { caller: api } = await joinCaller();

    const joined = await api.machines.join({ name: 'mac', repositories: { kind: 'folder', path: '/srv/a,b;c' } });

    expect(joined.setupLine.includes(" --repositories-in '/srv/a,b;c'")).toBe(true);
  });

  it('refuses a list entry holding a comma as a bad request, and commissions no ship', async () => {
    const { fleet, caller: api } = await joinCaller();

    await expect(refusalOf(api.machines.join({ name: 'mac', repositories: { kind: 'list', entries: ['/a,b'] } }))).resolves.toBe('BAD_REQUEST');
    expect(fleet.state.commissioned).toEqual([]);
  });
});

describe('guard configuration through the console router', () => {
  const replacement = {
    expectedVersion: 0,
    repositories: [{ repository: 'org/policy', folder: 'rules', access: 'private' as const }],
    secrets: ['org/policy'],
    secretValues: { 'org/policy': 'a-synthetic-test-value' },
    floor: ['required'],
  };

  it('reads guard metadata with fleet:read without requiring an Origin', async () => {
    await expect(caller({ kind: 'viewer', scopes: VIEWER }).guard.get()).resolves.toEqual({
      version: 0, repositories: [], sets: [], errors: [], conflicts: [], floor: [],
    });
  });

  it('forbids reading guard configuration without fleet:read', async () => {
    await expect(refusalOf(caller({ scopes: ['trierarch:guard'] }).guard.get())).resolves.toBe('FORBIDDEN');
  });

  it('replaces guard configuration with the guard scope and console Origin, keeping the token write-only', async () => {
    const guard = caller({ scopes: ['fleet:read', 'trierarch:guard'], origin: CONSOLE_ORIGIN }).guard;
    await expect(guard.replace(replacement)).resolves.toEqual({ version: 1 });
    await expect(guard.get()).resolves.toEqual({
      version: 1, repositories: replacement.repositories.map((repository) => ({ ...repository, readCommit: null })), floor: ['required'], sets: [], errors: [], conflicts: [],
    });
  });

  it('forbids replacing guard configuration with fleet:manage alone', async () => {
    await expect(refusalOf(caller({ scopes: OPERATOR, origin: CONSOLE_ORIGIN }).guard.replace(replacement))).resolves.toBe('FORBIDDEN');
  });

  it.each([undefined, 'https://other.example'])('forbids replacing guard configuration with Origin %s', async (origin) => {
    await expect(refusalOf(caller({ scopes: ['trierarch:guard'], origin }).guard.replace(replacement))).resolves.toBe('FORBIDDEN');
  });

  it('refuses stale guard replacements as conflicts', async () => {
    const guard = caller({ scopes: ['trierarch:guard'], origin: CONSOLE_ORIGIN }).guard;
    await guard.replace(replacement);
    await expect(refusalOf(guard.replace(replacement))).resolves.toBe('CONFLICT');
  });

  it('refuses invalid guard configurations as bad requests', async () => {
    const guard = caller({ scopes: ['trierarch:guard'], origin: CONSOLE_ORIGIN }).guard;
    await expect(refusalOf(guard.replace({ ...replacement, secrets: [] }))).resolves.toBe('BAD_REQUEST');
  });
});
