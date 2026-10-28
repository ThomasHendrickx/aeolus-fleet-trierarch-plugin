import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UsageHistory } from './ports.js';
import { nameOfValue, readShipNames } from './ship-names.js';
import type { SubscriptionWindows, WindowsChartKey, WindowsQuery } from './subscription-windows.js';
import { usageGrain } from './usage-range.js';

/** The machine and harness charts the Usage page shows at a time. */
export const WINDOWS_PAGE = 20;

export interface WindowsRequest {
  readonly fleetId: FleetId;
  readonly from: Date;
  readonly to: Date;
  readonly filters: WindowsQuery['filters'];
  /** The last chart of the page before; null for the first page. */
  readonly after: WindowsChartKey | null;
}

/** A page of charts, each machine named (null for one the fleet does not know), and where the next page starts; null when none is left. */
export interface WindowsPage {
  readonly charts: readonly (SubscriptionWindows & { readonly machineName: string | null })[];
  readonly next: WindowsChartKey | null;
}

export type ReadSubscriptionWindows = (request: WindowsRequest) => Promise<Result<WindowsPage, DomainError<'INVALID_RANGE' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: how full each harness's subscription windows were on each machine
 * in a range (the usage design, usage.windows): per machine and harness, 20 a
 * page, each window's readings as the trierarch took them. The range follows
 * the rule of the token usage it is shown under.
 */
export function createReadSubscriptionWindows(deps: { usage: UsageHistory; door: FleetDoor; connections: ConnectionStore }): ReadSubscriptionWindows {
  return async (request) => {
    const grain = usageGrain(request);
    if (!grain.isOk) {
      return grain;
    }
    // One more than a page tells whether another follows.
    const charts = await deps.usage.readWindows(request.fleetId, { from: request.from, to: request.to, filters: request.filters, after: request.after, limit: WINDOWS_PAGE + 1 });
    const names = await readShipNames(deps, { fleetId: request.fleetId, breakdown: 'machine' });
    if (!names.isOk) {
      return names;
    }
    const page = charts.slice(0, WINDOWS_PAGE);
    const last = page.at(-1);
    return ok({
      charts: page.map((chart) => ({ ...chart, machineName: nameOfValue(chart.machineShipId, names.value) })),
      next: charts.length > WINDOWS_PAGE && last ? { machineShipId: last.machineShipId, harness: last.harness } : null,
    });
  };
}
