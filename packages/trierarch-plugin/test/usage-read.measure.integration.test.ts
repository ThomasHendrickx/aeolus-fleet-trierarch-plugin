import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUsageHistory } from '../src/adapters/prisma/usage-history.js';
import type { TokenUsageQuery } from '../src/core/usage/token-usage.js';
import { createPluginDatabase } from '../src/testing/database.js';

// The Usage page's read at the target scale (the usage design, "Scale and
// retention"; L14: 3,000 ships per fleet, p95 under 100 ms). Seeded with 90
// days of one fleet's hours at 300 ships at work, 1.5 models each (about
// 450 rows an hour, a million in all), their rollup per UTC day, and a second
// fleet beside it. It measures, so it runs only with AEOLUS_MEASURE_USAGE=1,
// never in CI: `AEOLUS_MEASURE_USAGE=1 npx vitest run --project '*:integration' test/usage-read.measure.integration.test.ts`.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const NOW = new Date('2026-10-31T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;
const RUNS = 40;
const P95_BUDGET_MS = 100;

let db: PrismaClient;

/** One fleet's hours: each day 300 of its 3,000 ships at work, every hour, on 10 machines, half of them on two models, so its days hold 1/24 of its hours (the design's sizes). */
async function seed(fleetId: FleetId): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO usage_hours (fleet_id, hour, machine_ship_id, ship_id, folder_made_at, model, harness, login, input, output, cache_read, cache_write,
      estimated_cost_input_usd, estimated_cost_output_usd, estimated_cost_cache_read_usd, estimated_cost_cache_write_usd, read_at)
    SELECT $1, h, 'shp_machine' || (s % 10), 'shp_ship' || ((s + extract(epoch FROM h)::bigint / 86400 * 300) % 3000), '2026-08-01T00:00:00Z', m.model,
      CASE WHEN m.model LIKE 'gpt%' THEN 'codex' ELSE 'claude-code' END, CASE WHEN s % 7 = 0 THEN 'apiKey' ELSE 'subscription' END,
      1000 + s, 5000 + s, 200000 + s, 20000 + s,
      CASE WHEN m.model = 'gpt-6-sol' THEN NULL ELSE 0.004 END, CASE WHEN m.model = 'gpt-6-sol' THEN NULL ELSE 0.1 END,
      CASE WHEN m.model = 'gpt-6-sol' THEN NULL ELSE 0.04 END, CASE WHEN m.model = 'gpt-6-sol' THEN NULL ELSE 0.16 END, h + interval '1 hour'
    FROM generate_series($2::timestamptz, $3::timestamptz - interval '1 hour', interval '1 hour') AS h,
      generate_series(0, 299) AS s,
      LATERAL (SELECT 'claude-opus-5-5' AS model UNION ALL SELECT 'gpt-6-sol' WHERE s % 2 = 0) AS m`,
    fleetId,
    new Date(NOW.getTime() - 90 * DAY_MS),
    NOW,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO usage_days (fleet_id, day, machine_ship_id, ship_id, model, harness, login, input, output, cache_read, cache_write,
      estimated_cost_input_usd, estimated_cost_output_usd, estimated_cost_cache_read_usd, estimated_cost_cache_write_usd,
      unpriced_input, unpriced_output, unpriced_cache_read, unpriced_cache_write)
    SELECT fleet_id, (hour AT TIME ZONE 'UTC')::date, machine_ship_id, ship_id, model, harness, login, sum(input), sum(output), sum(cache_read), sum(cache_write),
      sum(coalesce(estimated_cost_input_usd, 0)), sum(coalesce(estimated_cost_output_usd, 0)), sum(coalesce(estimated_cost_cache_read_usd, 0)), sum(coalesce(estimated_cost_cache_write_usd, 0)),
      sum(CASE WHEN estimated_cost_input_usd IS NULL THEN input ELSE 0 END), sum(CASE WHEN estimated_cost_input_usd IS NULL THEN output ELSE 0 END),
      sum(CASE WHEN estimated_cost_input_usd IS NULL THEN cache_read ELSE 0 END), sum(CASE WHEN estimated_cost_input_usd IS NULL THEN cache_write ELSE 0 END)
    FROM usage_hours WHERE fleet_id = $1
    GROUP BY 1, 2, 3, 4, 5, 6, 7`,
    fleetId,
  );
}

/** The 95th percentile of the read's time over the runs, after one run to warm the cache. */
async function p95Of(query: TokenUsageQuery): Promise<number> {
  const history = createPrismaUsageHistory(db);
  await history.readTokens(FLEET, query);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    await history.readTokens(FLEET, query);
    times.push(performance.now() - start);
  }
  const sorted = times.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

describe.skipIf(process.env.AEOLUS_MEASURE_USAGE !== '1')('the usage read at the target scale (L14)', () => {
  beforeAll(async () => {
    db = createPrismaClient(await createPluginDatabase());
    await seed(FLEET);
    await seed(OTHER);
    // The test container's shared memory is small: a parallel vacuum of the indexes would not fit it.
    await db.$executeRawUnsafe('SET max_parallel_maintenance_workers = 0');
    await db.$executeRawUnsafe('VACUUM ANALYZE usage_hours');
    await db.$executeRawUnsafe('VACUUM ANALYZE usage_days');
  }, 600_000);

  afterAll(async () => {
    await db.$disconnect();
  });

  const cases: { name: string; query: TokenUsageQuery }[] = [
    { name: '7 days of hours, split by machine', query: { from: new Date(NOW.getTime() - 7 * DAY_MS), to: NOW, grain: 'hour', splitBy: 'machine', measure: 'tokens', filters: {} } },
    { name: '7 days of hours, split by ship', query: { from: new Date(NOW.getTime() - 7 * DAY_MS), to: NOW, grain: 'hour', splitBy: 'ship', measure: 'tokens', filters: {} } },
    { name: '24 hours, unsplit', query: { from: new Date(NOW.getTime() - DAY_MS), to: NOW, grain: 'hour', splitBy: null, measure: 'tokens', filters: {} } },
    { name: '90 days of days, split by model', query: { from: new Date(NOW.getTime() - 90 * DAY_MS), to: NOW, grain: 'day', splitBy: 'model', measure: 'cost', filters: {} } },
  ];

  it.each(cases)('reads $name under 100 ms at p95', async ({ name, query }) => {
    const p95 = await p95Of(query);
    console.info(`usage read, ${name}: p95 ${p95.toFixed(1)} ms over ${String(RUNS)} runs`);

    expect(p95).toBeLessThan(P95_BUDGET_MS);
  }, 120_000);
});
