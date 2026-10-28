import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { cannedUsageHistory } from '../../../test/support/memory-usage.js';
import { createReadTokenUsage, type TokenUsageRequest } from './read-token-usage.js';
import type { TokenUsage } from './token-usage.js';

// Reading the fleet's token usage for the console (the usage design, "The read
// the console calls"): hours up to 7 days, UTC days past that; split by one
// breakdown or by token kind; machines and ships named from the fleet's ships,
// retired ones included.

const AT = new Date('2026-10-28T08:00:00.000Z');
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3c';
const REVIEWER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4d';
const RETIRED: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h5e';
const UNKNOWN: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h6f';
const NINE = new Date('2026-10-28T09:00:00.000Z');
const TEN = new Date('2026-10-28T10:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
  fleet.state.ships.push(
    { shipId: MAC, name: 'trierarch-mac', type: 'trierarch', status: 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] },
    { shipId: REVIEWER, name: 'reviewer-01', type: 'reviewer', status: 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] },
    { shipId: RETIRED, name: 'builder-1301', type: 'implementer', status: 'retired', lastSeenAt: null, model: null, crewRequest: null, labels: [] },
  );
});

function aRequest(overrides: Partial<TokenUsageRequest> = {}): TokenUsageRequest {
  return { fleetId: FLEET_ID, from: NINE, to: new Date(NINE.getTime() + DAY_MS), splitBy: 'model', measure: 'tokens', filters: {}, ...overrides };
}

const amounts = (input: number, estimatedCostUsd: number) => ({ tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd, unpricedTokens: 0 });

/** Two hours of usage in two series, as the history answers them. */
function twoSeries(series: TokenUsage['series']): TokenUsage {
  return {
    series,
    buckets: [
      { at: NINE, amounts: [{ series: 0, ...amounts(30, 3) }, { series: 1, ...amounts(10, 1) }] },
      { at: TEN, amounts: [{ series: 0, ...amounts(5, 0.5) }] },
    ],
    unpricedModels: [],
  };
}

function read(history: TokenUsage, request: TokenUsageRequest = aRequest()) {
  return createReadTokenUsage({ usage: cannedUsageHistory(history), door: fleet.door, connections })(request);
}

describe("reading the fleet's token usage", () => {
  it('answers hours for a range of 7 days', async () => {
    const usage = await read(twoSeries([{ kind: 'value', value: 'claude-opus-5-5' }, { kind: 'value', value: 'claude-sonnet-5-5' }]), aRequest({ to: new Date(NINE.getTime() + 7 * DAY_MS) }));

    expect(usage).toMatchObject({ isOk: true, value: { grain: 'hour' } });
  });

  it('answers UTC days for a range past 7 days', async () => {
    const from = new Date('2026-10-01T00:00:00.000Z');

    const usage = await read(twoSeries([{ kind: 'all' }, { kind: 'other' }]), aRequest({ from, to: new Date(from.getTime() + 8 * DAY_MS) }));

    expect(usage).toMatchObject({ isOk: true, value: { grain: 'day' } });
  });

  it('adds each series up over the range, and the range as a whole', async () => {
    const usage = await read(twoSeries([{ kind: 'value', value: 'claude-opus-5-5' }, { kind: 'value', value: 'claude-sonnet-5-5' }]));

    expect(usage).toMatchObject({
      isOk: true,
      value: {
        series: [
          { key: { kind: 'value', value: 'claude-opus-5-5' }, name: 'claude-opus-5-5', amounts: amounts(35, 3.5) },
          { key: { kind: 'value', value: 'claude-sonnet-5-5' }, name: 'claude-sonnet-5-5', amounts: amounts(10, 1) },
        ],
        totals: amounts(45, 4.5),
      },
    });
  });

  it("names machines and ships by the fleet's ships, a retired one included, and an unknown one by nothing", async () => {
    const usage = await read(
      {
        series: [{ kind: 'value', value: RETIRED }, { kind: 'value', value: REVIEWER }, { kind: 'value', value: UNKNOWN }, { kind: 'other' }],
        buckets: [],
        unpricedModels: [],
      },
      aRequest({ splitBy: 'ship' }),
    );

    expect(usage).toMatchObject({ isOk: true, value: { series: [{ name: 'builder-1301' }, { name: 'reviewer-01' }, { name: null }, { key: { kind: 'other' }, name: null }] } });
  });

  it('names a login not reported by nothing', async () => {
    const usage = await read(twoSeries([{ kind: 'value', value: 'subscription:thomas' }, { kind: 'value', value: null }]), aRequest({ splitBy: 'login' }));

    expect(usage).toMatchObject({ isOk: true, value: { series: [{ name: 'subscription:thomas' }, { name: null }] } });
  });

  it('splits by token kind into input, output, cache read and cache write, each with its own tokens and no cost', async () => {
    const usage = await read(
      { series: [{ kind: 'all' }], buckets: [{ at: NINE, amounts: [{ series: 0, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, estimatedCostUsd: 9, unpricedTokens: 0 }] }], unpricedModels: [] },
      aRequest({ splitBy: 'kind' }),
    );

    expect(usage).toMatchObject({
      isOk: true,
      value: {
        series: [
          { key: { kind: 'tokenKind', tokenKind: 'input' }, name: null },
          { key: { kind: 'tokenKind', tokenKind: 'output' }, name: null },
          { key: { kind: 'tokenKind', tokenKind: 'cacheRead' }, name: null },
          { key: { kind: 'tokenKind', tokenKind: 'cacheWrite' }, name: null },
        ],
        buckets: [
          {
            at: NINE,
            amounts: [
              { series: 0, tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null, unpricedTokens: null },
              { series: 1, tokens: { input: 0, output: 2, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null, unpricedTokens: null },
              { series: 2, tokens: { input: 0, output: 0, cacheRead: 3, cacheWrite: 0 }, estimatedCostUsd: null, unpricedTokens: null },
              { series: 3, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 4 }, estimatedCostUsd: null, unpricedTokens: null },
            ],
          },
        ],
        totals: { tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, estimatedCostUsd: 9, unpricedTokens: 0 },
      },
    });
  });

  it('answers the models in the range the trierarch does not price', async () => {
    const usage = await read({ series: [], buckets: [], unpricedModels: ['gpt-6-sol'] });

    expect(usage).toMatchObject({ isOk: true, value: { unpricedModels: ['gpt-6-sol'], totals: amounts(0, 0) } });
  });

  it('reads no ship of the fleet when split by model, so it answers while the fleet does not', async () => {
    fleet.state.isAnswering = false;

    const usage = await read(twoSeries([{ kind: 'value', value: 'claude-opus-5-5' }, { kind: 'value', value: 'claude-sonnet-5-5' }]));

    expect(usage.isOk).toBe(true);
  });

  it('is refused when split by ship while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    const usage = await read(twoSeries([{ kind: 'value', value: REVIEWER }, { kind: 'other' }]), aRequest({ splitBy: 'ship' }));

    expect(usage).toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    const usage = await read(twoSeries([{ kind: 'value', value: MAC }, { kind: 'other' }]), aRequest({ splitBy: 'machine' }));

    expect(usage).toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('refuses a range that ends before it starts, or where it starts', async () => {
    await expect(read(twoSeries([]), aRequest({ from: TEN, to: NINE }))).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_RANGE' } });
    await expect(read(twoSeries([]), aRequest({ from: NINE, to: NINE }))).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_RANGE' } });
  });

  it('refuses a range of hours that does not start or end on a whole hour', async () => {
    const usage = await read(twoSeries([]), aRequest({ from: new Date(NINE.getTime() + 30 * 60 * 1000), to: TEN }));

    expect(usage).toMatchObject({ isOk: false, error: { kind: 'INVALID_RANGE' } });
  });

  it('refuses a range of days that does not start or end at a UTC midnight', async () => {
    const usage = await read(twoSeries([]), aRequest({ from: NINE, to: new Date(NINE.getTime() + 8 * DAY_MS) }));

    expect(usage).toMatchObject({ isOk: false, error: { kind: 'INVALID_RANGE' } });
  });
});
