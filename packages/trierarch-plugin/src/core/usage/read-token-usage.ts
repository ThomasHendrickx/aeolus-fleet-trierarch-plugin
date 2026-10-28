/**
 * Use case: the fleet's token usage as the console's Usage page reads it (the
 * usage design, "The read the console calls"): hours for a range up to 7 days,
 * UTC days from their rollup past that. The history adds up, ranks and
 * filters; this names each series and splits by token kind. Machines and ships
 * are named from one read of the fleet's ships, retired ones included, and the
 * fleet is read only when the split needs those names.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UsageHistory } from './ports.js';
import type { TokenUsage, UsageAmounts, UsageBreakdown, UsageFilters, UsageGrain, UsageMeasure, UsageSeriesKey } from './token-usage.js';
import type { TokenCounts } from './usage-reading.js';
import { nameOfValue, readShipNames } from './ship-names.js';
import { usageGrain } from './usage-range.js';

/** The four kinds of tokens, in the order the page shows them. */
export const TOKEN_KINDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const satisfies readonly (keyof TokenCounts)[];
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface TokenUsageRequest {
  readonly fleetId: FleetId;
  readonly from: Date;
  readonly to: Date;
  /** None: one series for all of it. */
  readonly splitBy: UsageBreakdown | 'kind' | null;
  readonly measure: UsageMeasure;
  readonly filters: UsageFilters;
}

/** A series' amounts; split by token kind, a kind has no cost of its own, nor tokens not priced. */
export interface SeriesAmounts {
  readonly tokens: TokenCounts;
  readonly estimatedCostUsd: number | null;
  readonly unpricedTokens: number | null;
}

export type TokenUsageSeriesKey = UsageSeriesKey | { readonly kind: 'tokenKind'; readonly tokenKind: TokenKind };

/** Token usage as the console shows it: each series named, with its total, and the range's totals. */
export interface TokenUsageView {
  readonly grain: UsageGrain;
  /** Largest first, other last. A name is null for other, all, a token kind, a login not reported and a ship the fleet does not know. */
  readonly series: readonly { readonly key: TokenUsageSeriesKey; readonly name: string | null; readonly amounts: SeriesAmounts }[];
  readonly buckets: readonly { readonly at: Date; readonly amounts: readonly (SeriesAmounts & { readonly series: number })[] }[];
  readonly totals: UsageAmounts;
  readonly unpricedModels: readonly string[];
}

export type ReadTokenUsage = (request: TokenUsageRequest) => Promise<Result<TokenUsageView, DomainError<'INVALID_RANGE' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

const NO_TOKENS: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function createReadTokenUsage(deps: { usage: UsageHistory; door: FleetDoor; connections: ConnectionStore }): ReadTokenUsage {
  return async (request) => {
    const grained = usageGrain(request);
    if (!grained.isOk) {
      return grained;
    }
    const grain = grained.value;

    const isByKind = request.splitBy === 'kind';
    const usage = await deps.usage.readTokens(request.fleetId, {
      from: request.from,
      to: request.to,
      grain,
      splitBy: isByKind ? null : request.splitBy,
      measure: request.measure,
      filters: request.filters,
    });

    const names = await readShipNames(deps, { fleetId: request.fleetId, breakdown: request.splitBy });
    if (!names.isOk) {
      return names;
    }
    const split = isByKind ? byTokenKind(usage) : { series: usage.series.map((key): TokenUsageSeriesKey => key), buckets: usage.buckets };
    return ok({
      grain,
      series: split.series.map((key, index) => ({ key, name: nameOf(key, names.value), amounts: seriesTotal(split.buckets, { series: index, isByKind }) })),
      buckets: split.buckets,
      totals: rangeTotal(usage),
      unpricedModels: usage.unpricedModels,
    });
  };
}

/** A series' name: its value's; other, all and a token kind have none. */
function nameOf(key: TokenUsageSeriesKey, shipNames: ReadonlyMap<string, string> | undefined): string | null {
  return key.kind === 'value' ? nameOfValue(key.value, shipNames) : null;
}

/** The one unsplit series as four, one per token kind, each holding only its kind's tokens. */
function byTokenKind(usage: TokenUsage): { series: TokenUsageSeriesKey[]; buckets: TokenUsageView['buckets'] } {
  return {
    series: TOKEN_KINDS.map((tokenKind) => ({ kind: 'tokenKind', tokenKind })),
    buckets: usage.buckets.map((bucket) => ({
      at: bucket.at,
      amounts: bucket.amounts.flatMap((amount) =>
        TOKEN_KINDS.map((tokenKind, series) => ({ series, tokens: { ...NO_TOKENS, [tokenKind]: amount.tokens[tokenKind] }, estimatedCostUsd: null, unpricedTokens: null })),
      ),
    })),
  };
}

function seriesTotal(buckets: TokenUsageView['buckets'], { series, isByKind }: { series: number; isByKind: boolean }): SeriesAmounts {
  const amounts = buckets.flatMap((bucket) => bucket.amounts.filter((amount) => amount.series === series));
  const total = addUp(amounts.map((amount) => ({ tokens: amount.tokens, estimatedCostUsd: amount.estimatedCostUsd ?? 0, unpricedTokens: amount.unpricedTokens ?? 0 })));
  return isByKind ? { tokens: total.tokens, estimatedCostUsd: null, unpricedTokens: null } : total;
}

function rangeTotal(usage: TokenUsage): UsageAmounts {
  return addUp(usage.buckets.flatMap((bucket) => bucket.amounts));
}

function addUp(amounts: readonly UsageAmounts[]): UsageAmounts {
  return amounts.reduce<UsageAmounts>(
    (total, amount) => ({
      tokens: {
        input: total.tokens.input + amount.tokens.input,
        output: total.tokens.output + amount.tokens.output,
        cacheRead: total.tokens.cacheRead + amount.tokens.cacheRead,
        cacheWrite: total.tokens.cacheWrite + amount.tokens.cacheWrite,
      },
      estimatedCostUsd: total.estimatedCostUsd + amount.estimatedCostUsd,
      unpricedTokens: total.unpricedTokens + amount.unpricedTokens,
    }),
    { tokens: NO_TOKENS, estimatedCostUsd: 0, unpricedTokens: 0 },
  );
}
