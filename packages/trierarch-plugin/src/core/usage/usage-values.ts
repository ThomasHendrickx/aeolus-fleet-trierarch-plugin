import type { UsageBreakdown, UsageGrain } from './token-usage.js';

/** One value of a breakdown with its tokens (all four kinds) in the range; a null login is "not reported". */
export interface UsageValue {
  readonly value: string | null;
  readonly tokens: number;
}

/** One page of a breakdown's values in a range, largest first, then by value; after the last value of the page before. */
export interface UsageValuesQuery {
  readonly from: Date;
  readonly to: Date;
  readonly grain: UsageGrain;
  readonly breakdown: UsageBreakdown;
  readonly after: UsageValue | null;
  readonly limit: number;
}
