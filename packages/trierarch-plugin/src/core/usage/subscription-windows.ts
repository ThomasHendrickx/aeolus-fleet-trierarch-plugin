import type { ShipId } from '@aeolus-fleet/common';

/** One machine and harness: where a page of subscription windows left off. */
export interface WindowsChartKey {
  readonly machineShipId: ShipId;
  readonly harness: string;
}

/** The subscription windows of one harness on one machine in a range: each window's readings, oldest first. */
export interface SubscriptionWindows extends WindowsChartKey {
  readonly windows: readonly {
    readonly windowMinutes: number;
    readonly readings: readonly { readonly readAt: Date; readonly usedPercent: number; readonly resetsAt: Date }[];
  }[];
}

/** One page of machine and harness charts in a range, from inclusive, to exclusive, ordered by machine then harness. */
export interface WindowsQuery {
  readonly from: Date;
  readonly to: Date;
  readonly filters: { readonly machineShipIds?: readonly ShipId[]; readonly harnesses?: readonly string[] };
  readonly after: WindowsChartKey | null;
  readonly limit: number;
}
