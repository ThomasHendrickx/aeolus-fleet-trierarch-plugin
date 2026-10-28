import type { FleetId } from '@aeolus-fleet/common';

import type { TokenUsage, TokenUsageQuery } from './token-usage.js';
import type { UsageReading } from './usage-reading.js';
import type { UsageValue, UsageValuesQuery } from './usage-values.js';

/**
 * Outbound port: each fleet's usage history (0030, the usage design). Recording
 * a reading keeps, per hour row, the newest reading of it, so a reading handed
 * again or arriving late changes nothing; each subscription reading is kept once.
 * Reading token usage adds up, splits, ranks and filters in the store itself,
 * and so does reading a breakdown's values, a page at a time.
 */
export interface UsageHistory {
  record(fleetId: FleetId, reading: UsageReading): Promise<void>;
  readTokens(fleetId: FleetId, query: TokenUsageQuery): Promise<TokenUsage>;
  readValues(fleetId: FleetId, query: UsageValuesQuery): Promise<UsageValue[]>;
}
