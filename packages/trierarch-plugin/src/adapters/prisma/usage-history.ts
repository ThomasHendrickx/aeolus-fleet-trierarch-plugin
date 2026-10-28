/**
 * Each fleet's usage history in the plugin's own database (decision 0030, the
 * usage design). One reading is one transaction: every hour row is set to the
 * reading when its read_at is newer than the stored one, and each change moves
 * the difference into usage_days. Sums run in Postgres numeric, so the rollup
 * never drifts from its hours.
 *
 * Locks are taken in one order, so two readings at once never deadlock: first
 * every hour row, sorted by its key, then every day row, sorted by its key.
 *
 * A read of token usage adds up, ranks and filters in one query: hours from
 * usage_hours, UTC days from usage_days, each a range scan of its primary key
 * or unique index, fleet and time first.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { UsageHistory } from '../../core/usage/ports.js';
import type { TokenUsage, TokenUsageQuery, UsageBreakdown, UsageFilters, UsageSeriesKey } from '../../core/usage/token-usage.js';
import type { UsageHour, UsageReading } from '../../core/usage/usage-reading.js';
import type { UsageValue, UsageValuesQuery } from '../../core/usage/usage-values.js';
import type { SubscriptionWindows, WindowsQuery } from '../../core/usage/subscription-windows.js';
import type { Db, PrismaClient } from './client.js';
import { Prisma } from './generated/client.js';

/** One hour row's values as Postgres holds them, numbers as text so a difference stays exact. */
interface StoredValues {
  readonly harness: string;
  readonly login: string | null;
  readonly input: string;
  readonly output: string;
  readonly cache_read: string;
  readonly cache_write: string;
  /** All four null when the trierarch does not price the model. */
  readonly estimated_cost_input_usd: string | null;
  readonly estimated_cost_output_usd: string | null;
  readonly estimated_cost_cache_read_usd: string | null;
  readonly estimated_cost_cache_write_usd: string | null;
}

/** The transaction one reading is recorded in, with its fleet. */
interface Scope {
  readonly tx: Db;
  readonly fleetId: FleetId;
  readonly reading: UsageReading;
}

/** An amount to add to one day row: an hour row's values, added or taken away. */
interface DayChange {
  readonly shipId: string;
  readonly day: string;
  readonly model: string;
  readonly values: StoredValues;
  readonly isTakenAway: boolean;
}

export function createPrismaUsageHistory(db: PrismaClient): UsageHistory {
  return {
    record: async (fleetId, reading) => {
      await db.$transaction(async (tx) => {
        const changes: DayChange[] = [];
        const scope = { tx, fleetId, reading };
        for (const hour of [...reading.hours].sort(byHourKey)) {
          changes.push(...(await setHour(scope, hour)));
        }
        for (const change of changes.sort(byDayKey)) {
          await addToDay(scope, change);
        }
        await addSubscriptionReadings(scope);
      });
    },
    readTokens: async (fleetId, query) => {
      const source = sourceOf(fleetId, query);
      const [rows, unpriced] = await Promise.all([db.$queryRaw<BucketRow[]>(bucketsQuery(source, query)), db.$queryRaw<{ model: string }[]>(unpricedModelsQuery(source))]);
      return toTokenUsage(rows, { splitBy: query.splitBy, unpricedModels: unpriced.map((row) => row.model) });
    },
    readValues: (fleetId, query) => db.$queryRaw<UsageValue[]>(valuesQuery(fleetId, query)),
    readWindows: async (fleetId, query) => toWindows(await db.$queryRaw<WindowRow[]>(windowsQuery(fleetId, query))),
  };
}

/** Sets one hour row to the reading, unless the stored one is as new; answers what its day gains and loses. */
async function setHour({ tx, fleetId, reading }: Scope, hour: UsageHour): Promise<DayChange[]> {
  const values: StoredValues = {
    harness: hour.harness,
    login: hour.login,
    input: String(hour.tokens.input),
    output: String(hour.tokens.output),
    cache_read: String(hour.tokens.cacheRead),
    cache_write: String(hour.tokens.cacheWrite),
    estimated_cost_input_usd: costText(hour.estimatedCostUsd?.input),
    estimated_cost_output_usd: costText(hour.estimatedCostUsd?.output),
    estimated_cost_cache_read_usd: costText(hour.estimatedCostUsd?.cacheRead),
    estimated_cost_cache_write_usd: costText(hour.estimatedCostUsd?.cacheWrite),
  };
  const change = (dayValues: StoredValues, isTakenAway: boolean): DayChange => ({ shipId: hour.shipId, day: utcDay(hour.hour), model: hour.model, values: dayValues, isTakenAway });

  // A row another reading is inserting makes this wait for it, then do nothing.
  const inserted = await tx.$queryRaw<unknown[]>`
    INSERT INTO usage_hours (fleet_id, hour, machine_ship_id, ship_id, folder_made_at, model, harness, login, input, output, cache_read, cache_write,
      estimated_cost_input_usd, estimated_cost_output_usd, estimated_cost_cache_read_usd, estimated_cost_cache_write_usd, read_at)
    VALUES (${fleetId}, ${hour.hour}, ${reading.machineShipId}, ${hour.shipId}, ${hour.folderMadeAt}, ${hour.model}, ${hour.harness}, ${hour.login},
      ${values.input}::bigint, ${values.output}::bigint, ${values.cache_read}::bigint, ${values.cache_write}::bigint,
      ${values.estimated_cost_input_usd}::numeric, ${values.estimated_cost_output_usd}::numeric, ${values.estimated_cost_cache_read_usd}::numeric,
      ${values.estimated_cost_cache_write_usd}::numeric, ${reading.readAt})
    ON CONFLICT DO NOTHING
    RETURNING 1`;
  if (inserted.length > 0) {
    return [change(values, false)];
  }

  const [stored] = await tx.$queryRaw<(StoredValues & { read_at: Date })[]>`
    SELECT harness, login, input::text, output::text, cache_read::text, cache_write::text, estimated_cost_input_usd::text, estimated_cost_output_usd::text,
      estimated_cost_cache_read_usd::text, estimated_cost_cache_write_usd::text, read_at
    FROM usage_hours
    WHERE fleet_id = ${fleetId} AND hour = ${hour.hour} AND machine_ship_id = ${reading.machineShipId} AND ship_id = ${hour.shipId} AND folder_made_at = ${hour.folderMadeAt} AND model = ${hour.model}
    FOR UPDATE`;
  if (stored === undefined || stored.read_at.getTime() >= reading.readAt.getTime()) {
    return [];
  }
  await tx.$executeRaw`
    UPDATE usage_hours
    SET harness = ${hour.harness}, login = ${hour.login}, input = ${values.input}::bigint, output = ${values.output}::bigint, cache_read = ${values.cache_read}::bigint,
      cache_write = ${values.cache_write}::bigint, estimated_cost_input_usd = ${values.estimated_cost_input_usd}::numeric,
      estimated_cost_output_usd = ${values.estimated_cost_output_usd}::numeric, estimated_cost_cache_read_usd = ${values.estimated_cost_cache_read_usd}::numeric,
      estimated_cost_cache_write_usd = ${values.estimated_cost_cache_write_usd}::numeric, read_at = ${reading.readAt}
    WHERE fleet_id = ${fleetId} AND hour = ${hour.hour} AND machine_ship_id = ${reading.machineShipId} AND ship_id = ${hour.shipId} AND folder_made_at = ${hour.folderMadeAt} AND model = ${hour.model}`;
  return [change(stored, true), change(values, false)];
}

/**
 * Adds an hour row's values to its day row, or takes them away: each kind's
 * cost, or, when the trierarch does not price the model, each kind's tokens as
 * not priced.
 */
async function addToDay({ tx, fleetId, reading }: Scope, change: DayChange): Promise<void> {
  const sign = change.isTakenAway ? -1 : 1;
  const { values } = change;
  await tx.$executeRaw`
    INSERT INTO usage_days (fleet_id, day, machine_ship_id, ship_id, model, harness, login, input, output, cache_read, cache_write,
      estimated_cost_input_usd, estimated_cost_output_usd, estimated_cost_cache_read_usd, estimated_cost_cache_write_usd,
      unpriced_input, unpriced_output, unpriced_cache_read, unpriced_cache_write)
    SELECT ${fleetId}, ${change.day}::date, ${reading.machineShipId}, ${change.shipId}, ${change.model}, ${values.harness}, ${values.login},
      ${sign} * t.input, ${sign} * t.output, ${sign} * t.cache_read, ${sign} * t.cache_write,
      ${sign} * coalesce(t.cost_input, 0), ${sign} * coalesce(t.cost_output, 0), ${sign} * coalesce(t.cost_cache_read, 0), ${sign} * coalesce(t.cost_cache_write, 0),
      ${sign} * CASE WHEN t.cost_input IS NULL THEN t.input ELSE 0 END, ${sign} * CASE WHEN t.cost_input IS NULL THEN t.output ELSE 0 END,
      ${sign} * CASE WHEN t.cost_input IS NULL THEN t.cache_read ELSE 0 END, ${sign} * CASE WHEN t.cost_input IS NULL THEN t.cache_write ELSE 0 END
    FROM (SELECT ${values.input}::bigint AS input, ${values.output}::bigint AS output, ${values.cache_read}::bigint AS cache_read,
      ${values.cache_write}::bigint AS cache_write, ${values.estimated_cost_input_usd}::numeric AS cost_input, ${values.estimated_cost_output_usd}::numeric AS cost_output,
      ${values.estimated_cost_cache_read_usd}::numeric AS cost_cache_read, ${values.estimated_cost_cache_write_usd}::numeric AS cost_cache_write) AS t
    ON CONFLICT (fleet_id, day, machine_ship_id, ship_id, model, harness, login) DO UPDATE
    SET input = usage_days.input + EXCLUDED.input, output = usage_days.output + EXCLUDED.output, cache_read = usage_days.cache_read + EXCLUDED.cache_read,
      cache_write = usage_days.cache_write + EXCLUDED.cache_write,
      estimated_cost_input_usd = usage_days.estimated_cost_input_usd + EXCLUDED.estimated_cost_input_usd,
      estimated_cost_output_usd = usage_days.estimated_cost_output_usd + EXCLUDED.estimated_cost_output_usd,
      estimated_cost_cache_read_usd = usage_days.estimated_cost_cache_read_usd + EXCLUDED.estimated_cost_cache_read_usd,
      estimated_cost_cache_write_usd = usage_days.estimated_cost_cache_write_usd + EXCLUDED.estimated_cost_cache_write_usd,
      unpriced_input = usage_days.unpriced_input + EXCLUDED.unpriced_input, unpriced_output = usage_days.unpriced_output + EXCLUDED.unpriced_output,
      unpriced_cache_read = usage_days.unpriced_cache_read + EXCLUDED.unpriced_cache_read, unpriced_cache_write = usage_days.unpriced_cache_write + EXCLUDED.unpriced_cache_write`;
}

/** A cost as Postgres numeric reads it exactly; none when the model is not priced. */
function costText(usd: number | undefined): string | null {
  return usd === undefined ? null : String(usd);
}

async function addSubscriptionReadings({ tx, fleetId, reading }: Scope): Promise<void> {
  const rows = reading.subscriptions.flatMap((subscription) =>
    subscription.windows.map((window) => ({
      fleetId,
      machineShipId: reading.machineShipId,
      harness: subscription.harness,
      windowMinutes: window.windowMinutes,
      readAt: subscription.readAt,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt,
    })),
  );
  await tx.subscriptionReading.createMany({ data: rows, skipDuplicates: true });
}

/** The UTC day an hour starts in, as Postgres reads a date. */
function utcDay(hour: Date): string {
  return hour.toISOString().slice(0, 'yyyy-mm-dd'.length);
}

function byHourKey(a: UsageHour, b: UsageHour): number {
  return a.hour.getTime() - b.hour.getTime() || a.shipId.localeCompare(b.shipId) || a.folderMadeAt.getTime() - b.folderMadeAt.getTime() || a.model.localeCompare(b.model);
}

function byDayKey(a: DayChange, b: DayChange): number {
  return (
    a.day.localeCompare(b.day) ||
    a.shipId.localeCompare(b.shipId) ||
    a.model.localeCompare(b.model) ||
    a.values.harness.localeCompare(b.values.harness) ||
    (a.values.login ?? '').localeCompare(b.values.login ?? '')
  );
}

/** The series past which the rest are added up as other. */
const MOST_SERIES = 7;

/** The column each breakdown splits by, in both tables. */
const SPLIT_COLUMNS: Record<UsageBreakdown, Prisma.Sql> = {
  machine: Prisma.sql`machine_ship_id`,
  harness: Prisma.sql`harness`,
  model: Prisma.sql`model`,
  ship: Prisma.sql`ship_id`,
  login: Prisma.sql`login`,
};

/** One bucket of one series as the query answers it: rank 1 is the largest series, MOST_SERIES + 1 is other. */
interface BucketRow {
  readonly at: Date;
  readonly rank: number;
  readonly key: string | null;
  readonly input: number;
  readonly output: number;
  readonly cache_read: number;
  readonly cache_write: number;
  readonly cost_input: number;
  readonly cost_output: number;
  readonly cost_cache_read: number;
  readonly cost_cache_write: number;
  readonly unpriced_input: number;
  readonly unpriced_output: number;
  readonly unpriced_cache_read: number;
  readonly unpriced_cache_write: number;
}

/** The amounts every read row carries and the buckets add up, each kind apart. */
const AMOUNT_COLUMNS = [
  'input',
  'output',
  'cache_read',
  'cache_write',
  'cost_input',
  'cost_output',
  'cost_cache_read',
  'cost_cache_write',
  'unpriced_input',
  'unpriced_output',
  'unpriced_cache_read',
  'unpriced_cache_write',
] as const;

/** The rows of a read, one per hour or day row in range and filter: its bucket, its series key, its amounts and its model. */
interface Source {
  readonly rows: Prisma.Sql;
  /** The same rows narrowed to those holding tokens of a model the trierarch does not price. */
  readonly unpricedRows: Prisma.Sql;
}

function sourceOf(fleetId: FleetId, query: TokenUsageQuery): Source {
  const key = query.splitBy === null ? Prisma.sql`NULL::text` : SPLIT_COLUMNS[query.splitBy];
  const filters = filtersOf(query.filters);
  if (query.grain === 'hour') {
    const where = Prisma.sql`fleet_id = ${fleetId} AND hour >= ${query.from} AND hour < ${query.to} AND ${filters}`;
    return {
      // A model not priced has all four costs null: its tokens of each kind count as not priced.
      rows: Prisma.sql`SELECT hour AS at, ${key} AS key, input, output, cache_read, cache_write,
        coalesce(estimated_cost_input_usd, 0) AS cost_input, coalesce(estimated_cost_output_usd, 0) AS cost_output,
        coalesce(estimated_cost_cache_read_usd, 0) AS cost_cache_read, coalesce(estimated_cost_cache_write_usd, 0) AS cost_cache_write,
        CASE WHEN estimated_cost_input_usd IS NULL THEN input ELSE 0 END AS unpriced_input,
        CASE WHEN estimated_cost_input_usd IS NULL THEN output ELSE 0 END AS unpriced_output,
        CASE WHEN estimated_cost_input_usd IS NULL THEN cache_read ELSE 0 END AS unpriced_cache_read,
        CASE WHEN estimated_cost_input_usd IS NULL THEN cache_write ELSE 0 END AS unpriced_cache_write
        FROM usage_hours WHERE ${where}`,
      unpricedRows: Prisma.sql`SELECT model FROM usage_hours WHERE ${where} AND estimated_cost_input_usd IS NULL`,
    };
  }
  const where = Prisma.sql`fleet_id = ${fleetId} AND day >= (${query.from}::timestamptz AT TIME ZONE 'UTC')::date AND day < (${query.to}::timestamptz AT TIME ZONE 'UTC')::date AND ${filters}`;
  return {
    rows: Prisma.sql`SELECT day::timestamp AT TIME ZONE 'UTC' AS at, ${key} AS key, input, output, cache_read, cache_write,
      estimated_cost_input_usd AS cost_input, estimated_cost_output_usd AS cost_output, estimated_cost_cache_read_usd AS cost_cache_read,
      estimated_cost_cache_write_usd AS cost_cache_write, unpriced_input, unpriced_output, unpriced_cache_read, unpriced_cache_write
      FROM usage_days WHERE ${where}`,
    unpricedRows: Prisma.sql`SELECT model FROM usage_days WHERE ${where} AND unpriced_input + unpriced_output + unpriced_cache_read + unpriced_cache_write > 0`,
  };
}

/** Each filtered breakdown as one condition; a null login is "not reported". */
function filtersOf(filters: UsageFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  const anyOf = (column: Prisma.Sql, values: readonly string[] | undefined) => {
    if (values !== undefined) {
      conditions.push(Prisma.sql`${column} = ANY(${[...values]}::text[])`);
    }
  };
  anyOf(SPLIT_COLUMNS.machine, filters.machineShipIds);
  anyOf(SPLIT_COLUMNS.harness, filters.harnesses);
  anyOf(SPLIT_COLUMNS.model, filters.models);
  anyOf(SPLIT_COLUMNS.ship, filters.shipIds);
  if (filters.logins !== undefined) {
    const named = filters.logins.filter((login) => login !== null);
    const notReported = filters.logins.includes(null) ? Prisma.sql`OR login IS NULL` : Prisma.empty;
    conditions.push(Prisma.sql`(login = ANY(${named}::text[]) ${notReported})`);
  }
  return conditions.length === 0 ? Prisma.sql`TRUE` : Prisma.join(conditions, ' AND ');
}

/** The series ranked by their total of the measure, largest first (then by key), the ones past MOST_SERIES as other, added up per bucket. */
function bucketsQuery(source: Source, query: TokenUsageQuery): Prisma.Sql {
  const measure = query.measure === 'tokens' ? Prisma.sql`input + output + cache_read + cache_write` : Prisma.sql`cost_input + cost_output + cost_cache_read + cost_cache_write`;
  // Raw only over AMOUNT_COLUMNS, this file's own constants: no input reaches it.
  const sums = Prisma.raw(AMOUNT_COLUMNS.map((column) => `sum(p.${column}) AS ${column}`).join(', '));
  const amounts = Prisma.raw(AMOUNT_COLUMNS.map((column) => `${column}::float8 AS ${column}`).join(', '));
  return Prisma.sql`
    WITH picked AS (${source.rows}),
    ranked AS (
      SELECT key, row_number() OVER (ORDER BY sum(${measure}) DESC, key ASC NULLS LAST) AS rank, count(*) OVER () AS keys
      FROM picked GROUP BY key
    ),
    grouped AS (
      SELECT p.at,
        CASE WHEN r.keys > ${MOST_SERIES} AND r.rank > ${MOST_SERIES} THEN ${MOST_SERIES + 1} ELSE r.rank END AS rank,
        CASE WHEN r.keys > ${MOST_SERIES} AND r.rank > ${MOST_SERIES} THEN NULL ELSE p.key END AS key,
        ${sums}
      FROM picked p JOIN ranked r ON r.key IS NOT DISTINCT FROM p.key
      GROUP BY 1, 2, 3
    )
    SELECT at, rank::int AS rank, key, ${amounts}
    FROM grouped ORDER BY at, rank`;
}

/** One page of a breakdown's values by their tokens, largest first, then by value with a login not reported last: after the cursor, up to the limit. */
function valuesQuery(fleetId: FleetId, query: UsageValuesQuery): Prisma.Sql {
  const source = sourceOf(fleetId, { from: query.from, to: query.to, grain: query.grain, splitBy: query.breakdown, measure: 'tokens', filters: {} });
  const { after } = query;
  let afterCursor = Prisma.sql`TRUE`;
  if (after?.value === null) {
    afterCursor = Prisma.sql`tokens < ${after.tokens}::numeric`;
  } else if (after) {
    afterCursor = Prisma.sql`(tokens < ${after.tokens}::numeric OR (tokens = ${after.tokens}::numeric AND (value > ${after.value} OR value IS NULL)))`;
  }
  return Prisma.sql`
    WITH totals AS (SELECT key AS value, sum(input + output + cache_read + cache_write) AS tokens FROM (${source.rows}) AS picked GROUP BY key)
    SELECT value, tokens::float8 AS tokens FROM totals
    WHERE ${afterCursor}
    ORDER BY tokens DESC, value ASC NULLS LAST
    LIMIT ${query.limit}`;
}

/** One reading of one window, as the windows query answers it. */
interface WindowRow {
  readonly machine_ship_id: SubscriptionWindows['machineShipId'];
  readonly harness: string;
  readonly window_minutes: number;
  readonly read_at: Date;
  readonly used_percent: number;
  readonly resets_at: Date;
}

/** Every reading in the range of a page of machine and harness pairs, after the cursor, ordered by machine, harness, window and time; the pairs carry the filters. */
function windowsQuery(fleetId: FleetId, query: WindowsQuery): Prisma.Sql {
  const conditions = [Prisma.sql`fleet_id = ${fleetId}`, Prisma.sql`read_at >= ${query.from}`, Prisma.sql`read_at < ${query.to}`];
  if (query.filters.machineShipIds !== undefined) {
    conditions.push(Prisma.sql`machine_ship_id = ANY(${[...query.filters.machineShipIds]}::text[])`);
  }
  if (query.filters.harnesses !== undefined) {
    conditions.push(Prisma.sql`harness = ANY(${[...query.filters.harnesses]}::text[])`);
  }
  const where = Prisma.join(conditions, ' AND ');
  const after = query.after === null ? Prisma.sql`TRUE` : Prisma.sql`(machine_ship_id, harness) > (${query.after.machineShipId}, ${query.after.harness})`;
  return Prisma.sql`
    WITH pairs AS (
      SELECT DISTINCT machine_ship_id, harness FROM subscription_readings
      WHERE ${where} AND ${after}
      ORDER BY machine_ship_id, harness LIMIT ${query.limit}
    )
    SELECT r.machine_ship_id, r.harness, r.window_minutes, r.read_at, r.used_percent::float8 AS used_percent, r.resets_at
    FROM subscription_readings r JOIN pairs p ON p.machine_ship_id = r.machine_ship_id AND p.harness = r.harness
    WHERE r.fleet_id = ${fleetId} AND r.read_at >= ${query.from} AND r.read_at < ${query.to}
    ORDER BY r.machine_ship_id, r.harness, r.window_minutes, r.read_at`;
}

/** The readings as charts: one per machine and harness, one window each per window length. */
function toWindows(rows: readonly WindowRow[]): SubscriptionWindows[] {
  const charts: { machineShipId: SubscriptionWindows['machineShipId']; harness: string; windows: { windowMinutes: number; readings: SubscriptionWindows['windows'][number]['readings'][number][] }[] }[] = [];
  for (const row of rows) {
    let chart = charts.at(-1);
    if (chart?.machineShipId !== row.machine_ship_id || chart.harness !== row.harness) {
      chart = { machineShipId: row.machine_ship_id, harness: row.harness, windows: [] };
      charts.push(chart);
    }
    let window = chart.windows.at(-1);
    if (window?.windowMinutes !== row.window_minutes) {
      window = { windowMinutes: row.window_minutes, readings: [] };
      chart.windows.push(window);
    }
    window.readings.push({ readAt: row.read_at, usedPercent: row.used_percent, resetsAt: row.resets_at });
  }
  return charts;
}

function unpricedModelsQuery(source: Source): Prisma.Sql {
  return Prisma.sql`SELECT DISTINCT model FROM (${source.unpricedRows}) AS unpriced ORDER BY model`;
}

/** The rows as the port answers them: the series by rank, and per bucket the amounts of each series by its index. */
function toTokenUsage(rows: readonly BucketRow[], read: { splitBy: UsageBreakdown | null; unpricedModels: readonly string[] }): TokenUsage {
  const keys = new Map<number, string | null>(rows.map((row) => [row.rank, row.key]));
  const series = [...keys.keys()]
    .toSorted((a, b) => a - b)
    .map((rank): UsageSeriesKey => {
      if (read.splitBy === null) {
        return { kind: 'all' };
      }
      return rank > MOST_SERIES ? { kind: 'other' } : { kind: 'value', value: keys.get(rank) ?? null };
    });
  const buckets: { at: Date; amounts: TokenUsage['buckets'][number]['amounts'][number][] }[] = [];
  for (const row of rows) {
    const amount = {
      series: row.rank - 1,
      tokens: { input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write },
      estimatedCostUsd: { input: row.cost_input, output: row.cost_output, cacheRead: row.cost_cache_read, cacheWrite: row.cost_cache_write },
      unpricedTokens: { input: row.unpriced_input, output: row.unpriced_output, cacheRead: row.unpriced_cache_read, cacheWrite: row.unpriced_cache_write },
    };
    const last = buckets.at(-1);
    if (last?.at.getTime() === row.at.getTime()) {
      last.amounts.push(amount);
    } else {
      buckets.push({ at: row.at, amounts: [amount] });
    }
  }
  return { series, buckets, unpricedModels: read.unpricedModels };
}
