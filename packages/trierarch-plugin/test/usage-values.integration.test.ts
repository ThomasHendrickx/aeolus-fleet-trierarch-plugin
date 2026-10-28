import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUsageHistory } from '../src/adapters/prisma/usage-history.js';
import type { UsageValuesQuery } from '../src/core/usage/usage-values.js';
import type { UsageHour } from '../src/core/usage/usage-reading.js';
import { createPluginDatabase } from '../src/testing/database.js';

// The values of one breakdown in a range, for the Usage page's filter menus
// (the usage design, usage.values): each with its tokens, largest first, a page
// at a time after a cursor.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MAC: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8m1';
const NINE = new Date('2026-10-28T09:00:00.000Z');
const FOLDER_MADE_AT = new Date('2026-10-27T14:02:11.000Z');
const READ_AT = new Date('2026-10-28T12:00:40.000Z');

function anHour(overrides: Partial<UsageHour> = {}): UsageHour {
  return {
    hour: NINE,
    shipId: 'shp_01m3tb1zgr5h2ffee12xnch8s1',
    folderMadeAt: FOLDER_MADE_AT,
    model: 'claude-opus-5-5',
    harness: 'claude-code',
    login: null,
    tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
    estimatedCostUsd: 1,
    ...overrides,
  };
}

function tokens(total: number): UsageHour['tokens'] {
  return { input: total, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function aQuery(overrides: Partial<UsageValuesQuery> = {}): UsageValuesQuery {
  return { from: NINE, to: new Date('2026-10-28T12:00:00.000Z'), grain: 'hour', breakdown: 'model', after: null, limit: 20, ...overrides };
}

/** A ship id for the nth ship of a test that needs many. */
function nthShip(n: number): ShipId {
  return `shp_01m3tb1zgr5h2ffee12xnch8${String(n).padStart(2, '0')}`;
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

async function record(hours: UsageHour[], fleetId: FleetId = FLEET): Promise<void> {
  await history.record(fleetId, { machineShipId: MAC, readAt: READ_AT, hours, subscriptions: [] });
}

describe("the values of one breakdown of the fleet's usage, from Postgres", () => {
  it('lists the values in the range by their tokens, largest first, each with its total', async () => {
    await record([anHour({ model: 'claude-opus-5-5', tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 1 } }), anHour({ model: 'claude-sonnet-5-5', tokens: tokens(300) })]);

    await expect(history.readValues(FLEET, aQuery())).resolves.toEqual([
      { value: 'claude-sonnet-5-5', tokens: 300 },
      { value: 'claude-opus-5-5', tokens: 116 },
    ]);
  });

  it('lists the login not reported as a value of its own', async () => {
    await record([anHour({ shipId: nthShip(1), login: null, tokens: tokens(10) }), anHour({ shipId: nthShip(2), login: 'subscription:thomas', tokens: tokens(30) })]);

    await expect(history.readValues(FLEET, aQuery({ breakdown: 'login' }))).resolves.toEqual([
      { value: 'subscription:thomas', tokens: 30 },
      { value: null, tokens: 10 },
    ]);
  });

  it('answers at most the limit, and the values after a cursor on the next read', async () => {
    await record([1, 2, 3, 4, 5].map((n) => anHour({ shipId: nthShip(n), tokens: tokens(n * 10) })));

    const first = await history.readValues(FLEET, aQuery({ breakdown: 'ship', limit: 2 }));
    const next = await history.readValues(FLEET, aQuery({ breakdown: 'ship', limit: 2, after: { tokens: 40, value: nthShip(4) } }));

    expect(first).toEqual([
      { value: nthShip(5), tokens: 50 },
      { value: nthShip(4), tokens: 40 },
    ]);
    expect(next).toEqual([
      { value: nthShip(3), tokens: 30 },
      { value: nthShip(2), tokens: 20 },
    ]);
  });

  it('orders values with the same tokens by the value, so a page after a cursor misses none', async () => {
    await record([1, 2, 3].map((n) => anHour({ shipId: nthShip(n), tokens: tokens(10) })));

    const next = await history.readValues(FLEET, aQuery({ breakdown: 'ship', limit: 2, after: { tokens: 10, value: nthShip(1) } }));

    expect(next).toEqual([
      { value: nthShip(2), tokens: 10 },
      { value: nthShip(3), tokens: 10 },
    ]);
  });

  it('reads the values of a range of UTC days from their rollup', async () => {
    await record([anHour({ hour: NINE, tokens: tokens(1) }), anHour({ hour: new Date('2026-10-29T03:00:00.000Z'), tokens: tokens(2) })]);

    const values = await history.readValues(FLEET, aQuery({ grain: 'day', from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-29T00:00:00.000Z') }));

    expect(values).toEqual([{ value: 'claude-opus-5-5', tokens: 1 }]);
  });

  it("never lists another fleet's values", async () => {
    await record([anHour()], OTHER_FLEET);

    await expect(history.readValues(FLEET, aQuery())).resolves.toEqual([]);
  });
});
