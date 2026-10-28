/**
 * Each fleet's usage history in the plugin's own database (decision 0030, the
 * usage design). One reading is one transaction: every hour row is set to the
 * reading when its read_at is newer than the stored one, and each change moves
 * the difference into usage_days. Sums run in Postgres numeric, so the rollup
 * never drifts from its hours.
 *
 * Locks are taken in one order, so two readings at once never deadlock: first
 * every hour row, sorted by its key, then every day row, sorted by its key.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { UsageHistory } from '../../core/usage/ports.js';
import type { UsageHour, UsageReading } from '../../core/usage/usage-reading.js';
import type { Db, PrismaClient } from './client.js';

/** One hour row's values as Postgres holds them, numbers as text so a difference stays exact. */
interface StoredValues {
  readonly harness: string;
  readonly login: string | null;
  readonly input: string;
  readonly output: string;
  readonly cache_read: string;
  readonly cache_write: string;
  readonly estimated_cost_usd: string | null;
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
    estimated_cost_usd: hour.estimatedCostUsd === null ? null : String(hour.estimatedCostUsd),
  };
  const change = (dayValues: StoredValues, isTakenAway: boolean): DayChange => ({ shipId: hour.shipId, day: utcDay(hour.hour), model: hour.model, values: dayValues, isTakenAway });

  // A row another reading is inserting makes this wait for it, then do nothing.
  const inserted = await tx.$queryRaw<unknown[]>`
    INSERT INTO usage_hours (fleet_id, hour, machine_ship_id, ship_id, folder_made_at, model, harness, login, input, output, cache_read, cache_write, estimated_cost_usd, read_at)
    VALUES (${fleetId}, ${hour.hour}, ${reading.machineShipId}, ${hour.shipId}, ${hour.folderMadeAt}, ${hour.model}, ${hour.harness}, ${hour.login},
      ${values.input}::bigint, ${values.output}::bigint, ${values.cache_read}::bigint, ${values.cache_write}::bigint, ${values.estimated_cost_usd}::numeric, ${reading.readAt})
    ON CONFLICT DO NOTHING
    RETURNING 1`;
  if (inserted.length > 0) {
    return [change(values, false)];
  }

  const [stored] = await tx.$queryRaw<(StoredValues & { read_at: Date })[]>`
    SELECT harness, login, input::text, output::text, cache_read::text, cache_write::text, estimated_cost_usd::text, read_at
    FROM usage_hours
    WHERE fleet_id = ${fleetId} AND hour = ${hour.hour} AND machine_ship_id = ${reading.machineShipId} AND ship_id = ${hour.shipId} AND folder_made_at = ${hour.folderMadeAt} AND model = ${hour.model}
    FOR UPDATE`;
  if (stored === undefined || stored.read_at.getTime() >= reading.readAt.getTime()) {
    return [];
  }
  await tx.$executeRaw`
    UPDATE usage_hours
    SET harness = ${hour.harness}, login = ${hour.login}, input = ${values.input}::bigint, output = ${values.output}::bigint, cache_read = ${values.cache_read}::bigint,
      cache_write = ${values.cache_write}::bigint, estimated_cost_usd = ${values.estimated_cost_usd}::numeric, read_at = ${reading.readAt}
    WHERE fleet_id = ${fleetId} AND hour = ${hour.hour} AND machine_ship_id = ${reading.machineShipId} AND ship_id = ${hour.shipId} AND folder_made_at = ${hour.folderMadeAt} AND model = ${hour.model}`;
  return [change(stored, true), change(values, false)];
}

/** Adds an hour row's values to its day row, or takes them away; the hour's tokens count as not priced when it has no cost. */
async function addToDay({ tx, fleetId, reading }: Scope, change: DayChange): Promise<void> {
  const sign = change.isTakenAway ? -1 : 1;
  const { values } = change;
  await tx.$executeRaw`
    INSERT INTO usage_days (fleet_id, day, machine_ship_id, ship_id, model, harness, login, input, output, cache_read, cache_write, estimated_cost_usd, unpriced_tokens)
    SELECT ${fleetId}, ${change.day}::date, ${reading.machineShipId}, ${change.shipId}, ${change.model}, ${values.harness}, ${values.login},
      ${sign} * t.input, ${sign} * t.output, ${sign} * t.cache_read, ${sign} * t.cache_write,
      ${sign} * coalesce(t.cost, 0), ${sign} * CASE WHEN t.cost IS NULL THEN t.input + t.output + t.cache_read + t.cache_write ELSE 0 END
    FROM (SELECT ${values.input}::bigint AS input, ${values.output}::bigint AS output, ${values.cache_read}::bigint AS cache_read,
      ${values.cache_write}::bigint AS cache_write, ${values.estimated_cost_usd}::numeric AS cost) AS t
    ON CONFLICT (fleet_id, day, machine_ship_id, ship_id, model, harness, login) DO UPDATE
    SET input = usage_days.input + EXCLUDED.input, output = usage_days.output + EXCLUDED.output, cache_read = usage_days.cache_read + EXCLUDED.cache_read,
      cache_write = usage_days.cache_write + EXCLUDED.cache_write, estimated_cost_usd = usage_days.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
      unpriced_tokens = usage_days.unpriced_tokens + EXCLUDED.unpriced_tokens`;
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
