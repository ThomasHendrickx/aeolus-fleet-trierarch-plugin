import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UsageHistory } from './ports.js';
import type { UsageBreakdown } from './token-usage.js';
import { nameOfValue, readShipNames } from './ship-names.js';
import { usageGrain } from './usage-range.js';
import type { UsageValue } from './usage-values.js';

/** The values a filter menu shows at a time. */
export const USAGE_VALUES_PAGE = 20;

export interface UsageValuesRequest {
  readonly fleetId: FleetId;
  readonly from: Date;
  readonly to: Date;
  readonly breakdown: UsageBreakdown;
  /** The last value of the page before; null for the first page. */
  readonly after: UsageValue | null;
}

/** A page of values, each named as the token usage read names it, and where the next page starts; null when none is left. */
export interface UsageValuesPage {
  readonly values: readonly (UsageValue & { readonly name: string | null })[];
  readonly next: UsageValue | null;
}

export type ReadUsageValues = (request: UsageValuesRequest) => Promise<Result<UsageValuesPage, DomainError<'INVALID_RANGE' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the values of one breakdown in a range, for the Usage page's
 * filter menus (the usage design, usage.values): 20 a page, largest by tokens
 * first, in the grain token usage is read in. Machines and ships are named
 * from one read of the fleet's ships, retired ones included.
 */
export function createReadUsageValues(deps: { usage: UsageHistory; door: FleetDoor; connections: ConnectionStore }): ReadUsageValues {
  return async (request) => {
    const grain = usageGrain(request);
    if (!grain.isOk) {
      return grain;
    }
    // One more than a page tells whether another follows.
    const values = await deps.usage.readValues(request.fleetId, { from: request.from, to: request.to, grain: grain.value, breakdown: request.breakdown, after: request.after, limit: USAGE_VALUES_PAGE + 1 });
    const page = values.slice(0, USAGE_VALUES_PAGE);
    const names = await readShipNames(deps, { fleetId: request.fleetId, breakdown: request.breakdown });
    if (!names.isOk) {
      return names;
    }
    return ok({
      values: page.map((value) => ({ ...value, name: nameOfValue(value.value, names.value) })),
      next: values.length > USAGE_VALUES_PAGE ? (page.at(-1) ?? null) : null,
    });
  };
}
