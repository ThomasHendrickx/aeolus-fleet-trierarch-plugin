import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUsageHistory } from '../src/adapters/prisma/usage-history.js';
import type { SubscriptionReading } from '../src/core/usage/usage-reading.js';
import type { WindowsQuery } from '../src/core/usage/subscription-windows.js';
import { createPluginDatabase } from '../src/testing/database.js';

// The subscription windows of the fleet's machines in a range (the usage
// design, usage.windows): per machine and harness, each window's readings
// oldest first, a page of machine and harness pairs at a time.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const MAC: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8m1';
const LINUX: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8m2';
const NINE = new Date('2026-10-28T09:00:00.000Z');
const NOON = new Date('2026-10-28T12:00:00.000Z');
const RESETS = new Date('2026-10-28T14:00:00.000Z');
const WEEK_RESETS = new Date('2026-11-02T00:00:00.000Z');

function at(time: string): Date {
  return new Date(`2026-10-28T${time}:00.000Z`);
}

function aReading({ harness, readAt, fiveHours, week }: { harness: string; readAt: Date; fiveHours: number; week: number }): SubscriptionReading {
  return {
    harness,
    readAt,
    windows: [
      { windowMinutes: 300, usedPercent: fiveHours, resetsAt: RESETS },
      { windowMinutes: 10_080, usedPercent: week, resetsAt: WEEK_RESETS },
    ],
  };
}

function aQuery(overrides: Partial<WindowsQuery> = {}): WindowsQuery {
  return { from: NINE, to: NOON, filters: {}, after: null, limit: 20, ...overrides };
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

async function record(subscriptions: SubscriptionReading[], { machineShipId = MAC, fleetId = FLEET }: { machineShipId?: ShipId; fleetId?: FleetId } = {}): Promise<void> {
  await history.record(fleetId, { machineShipId, readAt: NOON, hours: [], subscriptions });
}

describe("the subscription windows of the fleet's machines, from Postgres", () => {
  it("answers each window's readings in the range oldest first, per machine and harness", async () => {
    await record([aReading({ harness: 'claude-code', readAt: at('10:00'), fiveHours: 20, week: 40 }), aReading({ harness: 'claude-code', readAt: at('09:30'), fiveHours: 10, week: 39.5 })]);

    await expect(history.readWindows(FLEET, aQuery())).resolves.toEqual([
      {
        machineShipId: MAC,
        harness: 'claude-code',
        windows: [
          {
            windowMinutes: 300,
            readings: [
              { readAt: at('09:30'), usedPercent: 10, resetsAt: RESETS },
              { readAt: at('10:00'), usedPercent: 20, resetsAt: RESETS },
            ],
          },
          {
            windowMinutes: 10_080,
            readings: [
              { readAt: at('09:30'), usedPercent: 39.5, resetsAt: WEEK_RESETS },
              { readAt: at('10:00'), usedPercent: 40, resetsAt: WEEK_RESETS },
            ],
          },
        ],
      },
    ]);
  });

  it('reads the range from its start up to, not including, its end', async () => {
    await record([aReading({ harness: 'claude-code', readAt: at('08:59'), fiveHours: 1, week: 1 }), aReading({ harness: 'claude-code', readAt: NINE, fiveHours: 2, week: 2 }), aReading({ harness: 'claude-code', readAt: NOON, fiveHours: 3, week: 3 })]);

    const charts = await history.readWindows(FLEET, aQuery());

    expect(charts[0]?.windows[0]?.readings.map((reading) => reading.usedPercent)).toEqual([2]);
  });

  it('answers each machine and harness as a chart of its own, a page at a time after the last of the page before', async () => {
    await record([aReading({ harness: 'claude-code', readAt: at('10:00'), fiveHours: 1, week: 1 }), aReading({ harness: 'codex', readAt: at('10:00'), fiveHours: 2, week: 2 })], { machineShipId: MAC });
    await record([aReading({ harness: 'claude-code', readAt: at('10:00'), fiveHours: 3, week: 3 })], { machineShipId: LINUX });

    const first = await history.readWindows(FLEET, aQuery({ limit: 2 }));
    const next = await history.readWindows(FLEET, aQuery({ limit: 2, after: { machineShipId: MAC, harness: 'codex' } }));

    expect(first.map((chart) => [chart.machineShipId, chart.harness])).toEqual([
      [MAC, 'claude-code'],
      [MAC, 'codex'],
    ]);
    expect(next.map((chart) => [chart.machineShipId, chart.harness])).toEqual([[LINUX, 'claude-code']]);
  });

  it('narrows to the filtered machines and harnesses', async () => {
    await record([aReading({ harness: 'claude-code', readAt: at('10:00'), fiveHours: 1, week: 1 }), aReading({ harness: 'codex', readAt: at('10:00'), fiveHours: 2, week: 2 })], { machineShipId: MAC });
    await record([aReading({ harness: 'claude-code', readAt: at('10:00'), fiveHours: 3, week: 3 })], { machineShipId: LINUX });

    const charts = await history.readWindows(FLEET, aQuery({ filters: { machineShipIds: [MAC], harnesses: ['codex'] } }));

    expect(charts.map((chart) => [chart.machineShipId, chart.harness])).toEqual([[MAC, 'codex']]);
  });

  it("never reads another fleet's windows", async () => {
    await record([aReading({ harness: 'claude-code', readAt: at('10:00'), fiveHours: 1, week: 1 })], { fleetId: OTHER_FLEET });

    await expect(history.readWindows(FLEET, aQuery())).resolves.toEqual([]);
  });
});
