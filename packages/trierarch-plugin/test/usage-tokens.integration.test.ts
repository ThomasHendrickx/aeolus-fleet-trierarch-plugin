import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUsageHistory } from '../src/adapters/prisma/usage-history.js';
import type { TokenUsageQuery } from '../src/core/usage/token-usage.js';
import type { UsageHour } from '../src/core/usage/usage-reading.js';
import { createPluginDatabase } from '../src/testing/database.js';

// Reading token usage from the trierarch plugin's database (the usage design,
// "The read the console calls"): added up per bucket and series in the query,
// the 7 largest series by the measure and other for the rest, filtered, hours
// from usage_hours and UTC days from usage_days.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MAC: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8m1';
const LINUX: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8m2';
const SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8s1';
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const NINE = new Date('2026-10-28T09:00:00.000Z');
const TEN = new Date('2026-10-28T10:00:00.000Z');
const ELEVEN = new Date('2026-10-28T11:00:00.000Z');
const FOLDER_MADE_AT = new Date('2026-10-27T14:02:11.000Z');
const READ_AT = new Date('2026-10-28T12:00:40.000Z');
const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function anHour(overrides: Partial<UsageHour> = {}): UsageHour {
  return { hour: NINE, shipId: SHIP, folderMadeAt: FOLDER_MADE_AT, model: OPUS, harness: 'claude-code', login: null, tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: 1, ...overrides };
}

function input(count: number): UsageHour['tokens'] {
  return { ...NO_TOKENS, input: count };
}

function aQuery(overrides: Partial<TokenUsageQuery> = {}): TokenUsageQuery {
  return { from: NINE, to: new Date('2026-10-28T12:00:00.000Z'), grain: 'hour', splitBy: 'model', measure: 'tokens', filters: {}, ...overrides };
}

/** A ship id for the nth ship of a test that needs many. */
function nthShip(n: number): ShipId {
  return `shp_01m3tb1zgr5h2ffee12xnch80${n}`;
}

let db: PrismaClient;
let history: ReturnType<typeof createPrismaUsageHistory>;

beforeEach(async () => {
  db = createPrismaClient(await createPluginDatabase());
  history = createPrismaUsageHistory(db);
});

afterEach(async () => {
  await db.$disconnect();
});

async function record(hours: UsageHour[], machineShipId: ShipId = MAC, fleetId: FleetId = FLEET): Promise<void> {
  await history.record(fleetId, { machineShipId, readAt: READ_AT, hours, subscriptions: [] });
}

describe("reading the fleet's token usage from Postgres", () => {
  it('adds each hour up per series, the hours oldest first and the series largest first', async () => {
    await record([
      anHour({ hour: NINE, model: OPUS, tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 }, estimatedCostUsd: 1.5 }),
      anHour({ hour: NINE, model: SONNET, tokens: input(300), estimatedCostUsd: 0.25 }),
      anHour({ hour: TEN, model: OPUS, shipId: nthShip(2), tokens: input(4), estimatedCostUsd: 0.5 }),
      anHour({ hour: TEN, model: OPUS, tokens: input(6), estimatedCostUsd: 0.25 }),
    ]);

    await expect(history.readTokens(FLEET, aQuery())).resolves.toEqual({
      series: [
        { kind: 'value', value: SONNET },
        { kind: 'value', value: OPUS },
      ],
      buckets: [
        {
          at: NINE,
          amounts: [
            { series: 0, tokens: input(300), estimatedCostUsd: 0.25, unpricedTokens: 0 },
            { series: 1, tokens: { input: 10, output: 2, cacheRead: 100, cacheWrite: 5 }, estimatedCostUsd: 1.5, unpricedTokens: 0 },
          ],
        },
        { at: TEN, amounts: [{ series: 1, tokens: input(10), estimatedCostUsd: 0.75, unpricedTokens: 0 }] },
      ],
      unpricedModels: [],
    });
  });

  it('ranks the series by estimated cost when that is the measure', async () => {
    await record([anHour({ model: OPUS, tokens: input(10), estimatedCostUsd: 5 }), anHour({ model: SONNET, tokens: input(300), estimatedCostUsd: 0.25 })]);

    const usage = await history.readTokens(FLEET, aQuery({ measure: 'cost' }));

    expect(usage.series).toEqual([
      { kind: 'value', value: OPUS },
      { kind: 'value', value: SONNET },
    ]);
  });

  it('keeps the 7 largest series and adds the rest up as other once there are 8', async () => {
    await record([1, 2, 3, 4, 5, 6, 7, 8].map((n) => anHour({ shipId: nthShip(n), tokens: input(n * 10), estimatedCostUsd: n })));

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: 'ship' }));

    expect(usage.series).toEqual([...[8, 7, 6, 5, 4, 3, 2].map((n) => ({ kind: 'value', value: nthShip(n) })), { kind: 'other' }]);
    expect(usage.buckets[0]?.amounts.at(-1)).toEqual({ series: 7, tokens: input(10), estimatedCostUsd: 1, unpricedTokens: 0 });
  });

  it('shows 7 series as they are, with no other', async () => {
    await record([1, 2, 3, 4, 5, 6, 7].map((n) => anHour({ shipId: nthShip(n), tokens: input(n * 10), estimatedCostUsd: n })));

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: 'ship' }));

    expect(usage.series).toHaveLength(7);
    expect(usage.series).not.toContainEqual({ kind: 'other' });
  });

  it('answers one series for all of it when split by nothing', async () => {
    await record([anHour({ model: OPUS, tokens: input(10), estimatedCostUsd: 1 }), anHour({ model: SONNET, tokens: input(5), estimatedCostUsd: 0.5 })]);

    await expect(history.readTokens(FLEET, aQuery({ splitBy: null }))).resolves.toEqual({
      series: [{ kind: 'all' }],
      buckets: [{ at: NINE, amounts: [{ series: 0, tokens: input(15), estimatedCostUsd: 1.5, unpricedTokens: 0 }] }],
      unpricedModels: [],
    });
  });

  it('splits by machine, with each machine its own series', async () => {
    await record([anHour({ tokens: input(10) })], MAC);
    await record([anHour({ tokens: input(30) })], LINUX);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: 'machine' }));

    expect(usage.series).toEqual([
      { kind: 'value', value: LINUX },
      { kind: 'value', value: MAC },
    ]);
  });

  it('splits by login, the hours before the trierarch named one as not reported', async () => {
    await record([anHour({ shipId: nthShip(1), login: null, tokens: input(10) }), anHour({ shipId: nthShip(2), login: 'subscription:thomas', tokens: input(30) })]);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: 'login' }));

    expect(usage.series).toEqual([
      { kind: 'value', value: 'subscription:thomas' },
      { kind: 'value', value: null },
    ]);
  });

  it('narrows to the filtered values of each breakdown, a filter on one machine leaving the other out', async () => {
    await record([anHour({ tokens: input(10) })], MAC);
    await record([anHour({ tokens: input(30) })], LINUX);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: null, filters: { machineShipIds: [MAC] } }));

    expect(usage.buckets).toEqual([{ at: NINE, amounts: [{ series: 0, tokens: input(10), estimatedCostUsd: 1, unpricedTokens: 0 }] }]);
  });

  it('narrows to the login not reported when the filter names it', async () => {
    await record([anHour({ shipId: nthShip(1), login: null, tokens: input(10) }), anHour({ shipId: nthShip(2), login: 'subscription:thomas', tokens: input(30) })]);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: null, filters: { logins: [null] } }));

    expect(usage.buckets).toEqual([{ at: NINE, amounts: [{ series: 0, tokens: input(10), estimatedCostUsd: 1, unpricedTokens: 0 }] }]);
  });

  it('reads the range from its first hour up to, not including, its end', async () => {
    await record([anHour({ hour: NINE, tokens: input(1) }), anHour({ hour: TEN, tokens: input(2) }), anHour({ hour: ELEVEN, tokens: input(4) })]);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: null, from: TEN, to: ELEVEN }));

    expect(usage.buckets).toEqual([{ at: TEN, amounts: [{ series: 0, tokens: input(2), estimatedCostUsd: 1, unpricedTokens: 0 }] }]);
  });

  it('reads UTC days from their rollup, each day one bucket at its midnight', async () => {
    await record([anHour({ hour: NINE, tokens: input(1) }), anHour({ hour: new Date('2026-10-28T23:00:00.000Z'), tokens: input(2) }), anHour({ hour: new Date('2026-10-29T00:00:00.000Z'), tokens: input(4) })]);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: null, grain: 'day', from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-30T00:00:00.000Z') }));

    expect(usage.buckets).toEqual([
      { at: new Date('2026-10-28T00:00:00.000Z'), amounts: [{ series: 0, tokens: input(3), estimatedCostUsd: 2, unpricedTokens: 0 }] },
      { at: new Date('2026-10-29T00:00:00.000Z'), amounts: [{ series: 0, tokens: input(4), estimatedCostUsd: 1, unpricedTokens: 0 }] },
    ]);
  });

  it('counts the tokens of a model the trierarch does not price apart, and names that model', async () => {
    await record([anHour({ model: OPUS, tokens: input(10), estimatedCostUsd: 1 }), anHour({ model: 'gpt-6-sol', tokens: { ...NO_TOKENS, input: 40, output: 2 }, estimatedCostUsd: null })]);

    const usage = await history.readTokens(FLEET, aQuery({ splitBy: null }));

    expect(usage.buckets).toEqual([{ at: NINE, amounts: [{ series: 0, tokens: { ...NO_TOKENS, input: 50, output: 2 }, estimatedCostUsd: 1, unpricedTokens: 42 }] }]);
    expect(usage.unpricedModels).toEqual(['gpt-6-sol']);
  });

  it("never reads another fleet's usage", async () => {
    await record([anHour({ tokens: input(10) })], MAC, OTHER_FLEET);

    await expect(history.readTokens(FLEET, aQuery())).resolves.toEqual({ series: [], buckets: [], unpricedModels: [] });
  });
});
