import type { UsageHistory } from '../../src/core/usage/ports.js';
import type { TokenUsage } from '../../src/core/usage/token-usage.js';

/** A usage history that answers every read of token usage with the usage given: adding up, ranking and filtering are the store's, proven on Postgres. */
export function cannedUsageHistory(usage: TokenUsage): UsageHistory {
  return {
    record: () => Promise.reject(new Error('not recorded by a read')),
    readTokens: () => Promise.resolve(usage),
  };
}
