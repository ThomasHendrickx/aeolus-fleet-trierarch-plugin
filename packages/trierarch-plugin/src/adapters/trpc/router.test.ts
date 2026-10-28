import type { FleetId, ScopeName, ShipId } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import { cannedUsageHistory } from '../../../test/support/memory-usage.js';
import { createListEnabledModels } from '../../core/models/list-enabled-models.js';
import { createSetModelEnabled } from '../../core/models/set-model-enabled.js';
import { createReadTokenUsage } from '../../core/usage/read-token-usage.js';
import { createReadSubscriptionWindows } from '../../core/usage/read-subscription-windows.js';
import { createReadUsageValues } from '../../core/usage/read-usage-values.js';
import type { TokenUsage } from '../../core/usage/token-usage.js';
import { ok } from '../../core/shared/result.js';
import { trierarchPluginRouter, type Context } from './router.js';

// The models procedures (model governance, M6): reading the fleet's enabled
// models is every signed-in session's, viewer included; enabling and disabling
// take fleet:manage. Each needs the trierarch plugin to serve the fleet and be
// connected to it. Reading usage (the usage design) is every signed-in
// session's too.

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const OPERATOR: readonly ScopeName[] = ['fleet:read', 'fleet:manage'];
const VIEWER: readonly ScopeName[] = ['fleet:read'];

/** Procedures these tests never reach. */
const notReached = () => Promise.reject(new Error('not reached by the models procedures'));

const NINE = new Date('2026-10-28T09:00:00.000Z');

/** One hour of Opus usage, as the history answers it. */
const OPUS_HOUR: TokenUsage = {
  series: [{ kind: 'value', value: OPUS }],
  buckets: [{ at: NINE, amounts: [{ series: 0, tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 }, estimatedCostUsd: 1.5, unpricedTokens: 0 }] }],
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
let windowsFleet: ReturnType<typeof fakePluginFleet>;
let windowsConnections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  models = memoryEnabledModels();
  windowsFleet = fakePluginFleet();
  windowsConnections = memoryConnectionStore();
  windowsFleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await windowsConnections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: NINE });
  windowsFleet.state.ships.push({ shipId: MAC, name: 'trierarch-mac', type: 'trierarch', status: 'crewed', lastSeenAt: NINE, model: null, crewRequest: null, labels: [] });
});

/** The router as the console's server calls it, for a session of the given scopes, on a fleet served and connected unless it says otherwise. */
function caller(session: { kind?: 'operator' | 'viewer'; scopes: readonly ScopeName[]; isServed?: boolean; isConnected?: boolean }) {
  const context: Context = {
    cookie: 'aeolus_session=a-session',
    origin: undefined,
    authenticateOperator: () => Promise.resolve(ok({ fleetId: FLEET_ID, kind: session.kind ?? 'operator', scopes: session.scopes })),
    isConnected: (fleetId: FleetId) => Promise.resolve(fleetId === FLEET_ID && (session.isConnected ?? true)),
    isServed: (fleetId: FleetId) => Promise.resolve(fleetId === FLEET_ID && (session.isServed ?? true)),
    heldConnection: notReached,
    installationTokenSent: undefined,
    installation: { mode: 'open', token: undefined },
    setFleetEnabled: notReached,
    readFleet: notReached,
    deleteFleet: notReached,
    readConnection: notReached,
    connect: notReached,
    joinMachine: notReached,
    newSetupLine: notReached,
    listMachines: notReached,
    checkCrewSettings: notReached,
    listEnabledModels: createListEnabledModels({ models }),
    setModelEnabled: createSetModelEnabled({ models }),
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
