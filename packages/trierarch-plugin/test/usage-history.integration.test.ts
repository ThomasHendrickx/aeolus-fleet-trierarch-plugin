import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaUsageHistory } from '../src/adapters/prisma/usage-history.js';
import type { UsageHour, UsageReading } from '../src/core/usage/usage-reading.js';
import { createPluginDatabase } from '../src/testing/database.js';

// Each fleet's usage history in the trierarch plugin's own database (0030, the
// usage design): usage_hours as each trierarch reads them, the newest reading
// per row winning; usage_days, their rollup per UTC day, in the same
// transaction; subscription_readings, each kept once.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MACHINE: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8m1';
const SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8s1';
const OPUS = 'claude-opus-5-5';
const NINE = new Date('2026-10-28T09:00:00.000Z');
const TEN = new Date('2026-10-28T10:00:00.000Z');
const NEXT_DAY = new Date('2026-10-29T00:00:00.000Z');
const FOLDER_MADE_AT = new Date('2026-10-27T14:02:11.000Z');
const FRESH_FOLDER_MADE_AT = new Date('2026-10-28T09:40:00.000Z');
const READ_AT = new Date('2026-10-28T11:00:40.000Z');
const LATER = new Date('2026-10-28T12:00:40.000Z');

function anHour(overrides: Partial<UsageHour> = {}): UsageHour {
  return {
    hour: NINE,
    shipId: SHIP,
    folderMadeAt: FOLDER_MADE_AT,
    model: OPUS,
    harness: 'claude-code',
    login: null,
    tokens: { input: 100, output: 20, cacheRead: 1000, cacheWrite: 50 },
    estimatedCostUsd: 1.25,
    ...overrides,
  };
}

function aReading(hours: readonly UsageHour[], overrides: Partial<UsageReading> = {}): UsageReading {
  return { machineShipId: MACHINE, readAt: READ_AT, hours, subscriptions: [], ...overrides };
}

function tokens(total: number): UsageHour['tokens'] {
  return { input: total, output: 0, cacheRead: 0, cacheWrite: 0 };
}

let db: PrismaClient;

beforeEach(async () => {
  db = createPrismaClient(await createPluginDatabase());
});

afterEach(async () => {
  await db.$disconnect();
});

async function storedHours(fleetId: FleetId = FLEET): Promise<unknown[]> {
  return db.$queryRaw`SELECT hour, folder_made_at, input::int, output::int, cache_read::int, cache_write::int, estimated_cost_usd::float8, login, read_at
    FROM usage_hours WHERE fleet_id = ${fleetId} ORDER BY hour, folder_made_at`;
}

async function storedDays(fleetId: FleetId = FLEET): Promise<unknown[]> {
  return db.$queryRaw`SELECT day::text, login, input::int, output::int, cache_read::int, cache_write::int, estimated_cost_usd::float8, unpriced_tokens::int
    FROM usage_days WHERE fleet_id = ${fleetId} ORDER BY day, login NULLS FIRST`;
}

describe("the fleet's usage history in Postgres", () => {
  it('keeps each hour of a reading, and adds the hours of one UTC day up in its day', async () => {
    const history = createPrismaUsageHistory(db);

    await history.record(FLEET, aReading([anHour({ hour: NINE }), anHour({ hour: TEN, tokens: tokens(7), estimatedCostUsd: 0.5 }), anHour({ hour: NEXT_DAY, tokens: tokens(3), estimatedCostUsd: 0.25 })]));

    await expect(storedHours()).resolves.toEqual([
      { hour: NINE, folder_made_at: FOLDER_MADE_AT, input: 100, output: 20, cache_read: 1000, cache_write: 50, estimated_cost_usd: 1.25, login: null, read_at: READ_AT },
      { hour: TEN, folder_made_at: FOLDER_MADE_AT, input: 7, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0.5, login: null, read_at: READ_AT },
      { hour: NEXT_DAY, folder_made_at: FOLDER_MADE_AT, input: 3, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0.25, login: null, read_at: READ_AT },
    ]);
    await expect(storedDays()).resolves.toEqual([
      { day: '2026-10-28', login: null, input: 107, output: 20, cache_read: 1000, cache_write: 50, estimated_cost_usd: 1.75, unpriced_tokens: 0 },
      { day: '2026-10-29', login: null, input: 3, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0.25, unpriced_tokens: 0 },
    ]);
  });

  it('changes nothing when the same reading is handed again', async () => {
    const history = createPrismaUsageHistory(db);
    await history.record(FLEET, aReading([anHour()]));

    await history.record(FLEET, aReading([anHour()]));

    await expect(storedDays()).resolves.toEqual([{ day: '2026-10-28', login: null, input: 100, output: 20, cache_read: 1000, cache_write: 50, estimated_cost_usd: 1.25, unpriced_tokens: 0 }]);
  });

  it("sets an hour to a newer reading's totals, and its day takes the difference", async () => {
    const history = createPrismaUsageHistory(db);
    await history.record(FLEET, aReading([anHour({ tokens: tokens(100), estimatedCostUsd: 1 })]));

    await history.record(FLEET, aReading([anHour({ tokens: tokens(150), estimatedCostUsd: 1.5 })], { readAt: LATER }));

    await expect(storedHours()).resolves.toEqual([{ hour: NINE, folder_made_at: FOLDER_MADE_AT, input: 150, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.5, login: null, read_at: LATER }]);
    await expect(storedDays()).resolves.toEqual([{ day: '2026-10-28', login: null, input: 150, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.5, unpriced_tokens: 0 }]);
  });

  it('keeps the newer reading when an older one arrives after it', async () => {
    const history = createPrismaUsageHistory(db);
    await history.record(FLEET, aReading([anHour({ tokens: tokens(150), estimatedCostUsd: 1.5 })], { readAt: LATER }));

    await history.record(FLEET, aReading([anHour({ tokens: tokens(100), estimatedCostUsd: 1 })]));

    await expect(storedHours()).resolves.toEqual([{ hour: NINE, folder_made_at: FOLDER_MADE_AT, input: 150, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.5, login: null, read_at: LATER }]);
    await expect(storedDays()).resolves.toEqual([{ day: '2026-10-28', login: null, input: 150, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.5, unpriced_tokens: 0 }]);
  });

  it("keeps a fresh folder's hour apart from the old folder's hour of the same ship", async () => {
    const history = createPrismaUsageHistory(db);
    await history.record(FLEET, aReading([anHour({ tokens: tokens(100), estimatedCostUsd: 1 })]));

    await history.record(FLEET, aReading([anHour({ folderMadeAt: FRESH_FOLDER_MADE_AT, tokens: tokens(5), estimatedCostUsd: 0.05 })], { readAt: LATER }));

    await expect(storedHours()).resolves.toEqual([
      { hour: NINE, folder_made_at: FOLDER_MADE_AT, input: 100, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1, login: null, read_at: READ_AT },
      { hour: NINE, folder_made_at: FRESH_FOLDER_MADE_AT, input: 5, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0.05, login: null, read_at: LATER },
    ]);
    await expect(storedDays()).resolves.toEqual([{ day: '2026-10-28', login: null, input: 105, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.05, unpriced_tokens: 0 }]);
  });

  it('keeps no cost for a model the trierarch does not price, and its day counts those tokens as not priced', async () => {
    const history = createPrismaUsageHistory(db);

    await history.record(FLEET, aReading([anHour({ model: OPUS, tokens: tokens(100), estimatedCostUsd: 1 }), anHour({ model: 'gpt-6', tokens: { input: 40, output: 2, cacheRead: 0, cacheWrite: 0 }, estimatedCostUsd: null })]));

    await expect(db.$queryRaw`SELECT model, estimated_cost_usd IS NULL AS is_unpriced FROM usage_hours ORDER BY model`).resolves.toEqual([
      { model: OPUS, is_unpriced: false },
      { model: 'gpt-6', is_unpriced: true },
    ]);
    await expect(db.$queryRaw`SELECT model, estimated_cost_usd::float8, unpriced_tokens::int FROM usage_days ORDER BY model`).resolves.toEqual([
      { model: OPUS, estimated_cost_usd: 1, unpriced_tokens: 0 },
      { model: 'gpt-6', estimated_cost_usd: 0, unpriced_tokens: 42 },
    ]);
  });

  it("moves an hour's tokens in its day from not reported to the login a newer reading names", async () => {
    const history = createPrismaUsageHistory(db);
    await history.record(FLEET, aReading([anHour({ tokens: tokens(100), estimatedCostUsd: 1 })]));

    await history.record(FLEET, aReading([anHour({ login: 'subscription:thomas', tokens: tokens(120), estimatedCostUsd: 1.2 })], { readAt: LATER }));

    await expect(storedDays()).resolves.toEqual([
      { day: '2026-10-28', login: null, input: 0, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0, unpriced_tokens: 0 },
      { day: '2026-10-28', login: 'subscription:thomas', input: 120, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.2, unpriced_tokens: 0 },
    ]);
  });

  it('adds two readings of one hour stored at once up to the newer one in its day', async () => {
    const history = createPrismaUsageHistory(db);

    await Promise.all([
      history.record(FLEET, aReading([anHour({ tokens: tokens(100), estimatedCostUsd: 1 })])),
      history.record(FLEET, aReading([anHour({ tokens: tokens(150), estimatedCostUsd: 1.5 })], { readAt: LATER })),
    ]);

    await expect(storedDays()).resolves.toEqual([{ day: '2026-10-28', login: null, input: 150, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1.5, unpriced_tokens: 0 }]);
  });

  it('keeps each subscription window reading once, a repeat changing nothing', async () => {
    const history = createPrismaUsageHistory(db);
    const subscriptions: UsageReading['subscriptions'] = [
      { harness: 'claude-code', readAt: new Date('2026-10-28T09:31:02.000Z'), windows: [{ windowMinutes: 300, usedPercent: 42, resetsAt: new Date('2026-10-28T12:00:00.000Z') }, { windowMinutes: 10_080, usedPercent: 7, resetsAt: new Date('2026-11-02T00:00:00.000Z') }] },
    ];
    await history.record(FLEET, aReading([], { subscriptions }));

    await history.record(FLEET, aReading([], { subscriptions, readAt: LATER }));

    await expect(db.$queryRaw`SELECT machine_ship_id, harness, window_minutes, read_at, used_percent::float8, resets_at FROM subscription_readings ORDER BY window_minutes`).resolves.toEqual([
      { machine_ship_id: MACHINE, harness: 'claude-code', window_minutes: 300, read_at: new Date('2026-10-28T09:31:02.000Z'), used_percent: 42, resets_at: new Date('2026-10-28T12:00:00.000Z') },
      { machine_ship_id: MACHINE, harness: 'claude-code', window_minutes: 10_080, read_at: new Date('2026-10-28T09:31:02.000Z'), used_percent: 7, resets_at: new Date('2026-11-02T00:00:00.000Z') },
    ]);
  });

  it("keeps each fleet's usage apart", async () => {
    const history = createPrismaUsageHistory(db);
    await history.record(FLEET, aReading([anHour({ tokens: tokens(100), estimatedCostUsd: 1 })]));

    await history.record(OTHER, aReading([anHour({ tokens: tokens(9), estimatedCostUsd: 0.09 })], { readAt: LATER }));

    await expect(storedDays(FLEET)).resolves.toEqual([{ day: '2026-10-28', login: null, input: 100, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 1, unpriced_tokens: 0 }]);
    await expect(storedDays(OTHER)).resolves.toEqual([{ day: '2026-10-28', login: null, input: 9, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0.09, unpriced_tokens: 0 }]);
  });

  it("forgets a fleet's usage when the fleet is deleted, keeping another fleet's", async () => {
    const history = createPrismaUsageHistory(db);
    const subscriptions: UsageReading['subscriptions'] = [{ harness: 'claude-code', readAt: READ_AT, windows: [{ windowMinutes: 300, usedPercent: 42, resetsAt: new Date('2026-10-28T12:00:00.000Z') }] }];
    await history.record(FLEET, aReading([anHour()], { subscriptions }));
    await history.record(OTHER, aReading([anHour()], { subscriptions }));

    await createPrismaFleetForgetter(db).forget(FLEET);

    await expect(storedHours(FLEET)).resolves.toEqual([]);
    await expect(storedDays(FLEET)).resolves.toEqual([]);
    await expect(db.$queryRaw`SELECT fleet_id FROM subscription_readings`).resolves.toEqual([{ fleet_id: OTHER }]);
    await expect(storedHours(OTHER)).resolves.toHaveLength(1);
    await expect(storedDays(OTHER)).resolves.toHaveLength(1);
  });
});
