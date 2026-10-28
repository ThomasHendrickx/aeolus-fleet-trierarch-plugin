import type { UsageHistory } from '../../src/core/usage/ports.js';
import type { TokenUsage } from '../../src/core/usage/token-usage.js';
import type { UsageValue } from '../../src/core/usage/usage-values.js';

/** Values ordered as the store orders them: by tokens, largest first, then by value, a login not reported last. */
function byTokensThenValue(a: UsageValue, b: UsageValue): number {
  return b.tokens - a.tokens || (a.value === null ? 1 : b.value === null ? -1 : a.value.localeCompare(b.value));
}

/**
 * A usage history that answers every read of token usage with the usage given,
 * and every read of values with the values given, ordered, after the cursor
 * and up to the limit. Adding up, ranking and filtering are the store's, proven
 * on Postgres.
 */
export function cannedUsageHistory(usage: TokenUsage, values: readonly UsageValue[] = []): UsageHistory {
  return {
    record: () => Promise.reject(new Error('not recorded by a read')),
    readTokens: () => Promise.resolve(usage),
    readValues: (_fleetId, query) => {
      const ordered = values.toSorted(byTokensThenValue);
      const { after } = query;
      const start = after === null ? 0 : ordered.findIndex((value) => byTokensThenValue(value, after) > 0);
      return Promise.resolve(start === -1 ? [] : ordered.slice(start, start + query.limit));
    },
  };
}
