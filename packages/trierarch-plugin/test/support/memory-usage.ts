import type { FleetId } from '@aeolus-fleet/common';

import type { UsageHistory } from '../../src/core/usage/ports.js';
import type { TokenUsage } from '../../src/core/usage/token-usage.js';
import type { SubscriptionWindows } from '../../src/core/usage/subscription-windows.js';
import type { UsageReading } from '../../src/core/usage/usage-reading.js';
import type { UsageValue } from '../../src/core/usage/usage-values.js';

/** No token usage at all. */
const NO_USAGE: TokenUsage = { series: [], buckets: [], unpricedModels: [] };

/** Values ordered as the store orders them: by tokens, largest first, then by value, a login not reported last. */
function byTokensThenValue(a: UsageValue, b: UsageValue): number {
  return b.tokens - a.tokens || (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value));
}

/**
 * A usage history that answers every read of token usage with the usage given,
 * every read of values with the values given, and every read of windows with
 * the charts given, each ordered, after the cursor and up to the limit. Adding
 * up, ranking and filtering are the store's, proven on Postgres.
 */
export function cannedUsageHistory({ usage = NO_USAGE, values = [], windows = [] }: { usage?: TokenUsage; values?: readonly UsageValue[]; windows?: readonly SubscriptionWindows[] }): UsageHistory {
  return {
    record: () => Promise.reject(new Error('not recorded by a read')),
    prune: () => Promise.reject(new Error('not pruned by a read')),
    readTokens: () => Promise.resolve(usage),
    readValues: (_fleetId, query) => {
      const ordered = values.toSorted(byTokensThenValue);
      const { after } = query;
      const start = after === null ? 0 : ordered.findIndex((value) => byTokensThenValue(value, after) > 0);
      return Promise.resolve(start === -1 ? [] : ordered.slice(start, start + query.limit));
    },
    readWindows: (_fleetId, query) => {
      const key = (chart: { machineShipId: string; harness: string }) => `${chart.machineShipId} ${chart.harness}`;
      const { after } = query;
      const ordered = windows.toSorted((a, b) => key(a).localeCompare(key(b)));
      return Promise.resolve(ordered.filter((chart) => after === null || key(chart).localeCompare(key(after)) > 0).slice(0, query.limit));
    },
  };
}

/** A usage history that keeps each reading recorded, in order, per fleet; reads are not its part. */
export function recordingUsageHistory(): UsageHistory & { recorded: { fleetId: FleetId; reading: UsageReading }[]; pruned: { fleetId: FleetId; before: Date }[] } {
  const recorded: { fleetId: FleetId; reading: UsageReading }[] = [];
  const pruned: { fleetId: FleetId; before: Date }[] = [];
  return {
    recorded,
    pruned,
    prune: (fleetId, before) => {
      pruned.push({ fleetId, before });
      return Promise.resolve();
    },
    record: (fleetId, reading) => {
      recorded.push({ fleetId, reading });
      return Promise.resolve();
    },
    readTokens: () => Promise.resolve(NO_USAGE),
    readValues: () => Promise.resolve([]),
    readWindows: () => Promise.resolve([]),
  };
}
