import type { ShipId } from '@aeolus-fleet/common';

import type { TokenCounts } from './usage-reading.js';

/** What usage splits by, besides token kind: one of the setup that used the tokens. */
export const USAGE_BREAKDOWNS = ['machine', 'harness', 'model', 'ship', 'login'] as const;
export type UsageBreakdown = (typeof USAGE_BREAKDOWNS)[number];

/** What the series are ranked and shown by: tokens (all four kinds) or the estimated cost. */
export const USAGE_MEASURES = ['tokens', 'cost'] as const;
export type UsageMeasure = (typeof USAGE_MEASURES)[number];

/** Hours (from usage_hours) or UTC days (from their rollup). */
export type UsageGrain = 'hour' | 'day';

/** The values usage is narrowed to, per breakdown; a breakdown left out is not narrowed. A null login is "not reported". */
export interface UsageFilters {
  readonly machineShipIds?: readonly ShipId[];
  readonly harnesses?: readonly string[];
  readonly models?: readonly string[];
  readonly shipIds?: readonly ShipId[];
  readonly logins?: readonly (string | null)[];
}

/** One read of token usage: a range of whole hours or whole UTC days, from inclusive, to exclusive. */
export interface TokenUsageQuery {
  readonly from: Date;
  readonly to: Date;
  readonly grain: UsageGrain;
  /** None: one series for all of it. */
  readonly splitBy: UsageBreakdown | null;
  readonly measure: UsageMeasure;
  readonly filters: UsageFilters;
}

/** The tokens and estimated cost of one series in one bucket, or in all of the range. */
export interface UsageAmounts {
  readonly tokens: TokenCounts;
  /** Of the priced tokens only. */
  readonly estimatedCostUsd: number;
  /** The tokens of models the trierarch does not price. */
  readonly unpricedTokens: number;
}

/** A series of the read: one value of the breakdown (a null login is "not reported"), the rest as other, or all of it unsplit. */
export type UsageSeriesKey = { readonly kind: 'value'; readonly value: string | null } | { readonly kind: 'other' } | { readonly kind: 'all' };

/**
 * Token usage as the history answers it: the series by their total in the
 * range, largest first, at most 7 and other for the rest; each bucket that
 * holds usage, oldest first, with the amounts of each series in it by index;
 * and the models in the range the trierarch does not price.
 */
export interface TokenUsage {
  readonly series: readonly UsageSeriesKey[];
  readonly buckets: readonly { readonly at: Date; readonly amounts: readonly (UsageAmounts & { readonly series: number })[] }[];
  readonly unpricedModels: readonly string[];
}
