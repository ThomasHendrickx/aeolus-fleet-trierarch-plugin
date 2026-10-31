import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import type { IsServed } from '../installation/served.js';
import type { Clock } from '../shared/clock.js';
import type { UsageHistory } from './ports.js';

const DAY_MS = 24 * 60 * 60_000;

/** What a pass did with a fleet's usage: pruned before a cutoff, kept for good, or left as it was because the fleet refused its limits. */
export type PruneOutcome = { readonly kind: 'pruned'; readonly before: Date } | { readonly kind: 'keptForGood' } | { readonly kind: 'refused'; readonly refusal: FleetRefusal };

export type PruneUsage = () => Promise<{ fleetId: FleetId; outcome: PruneOutcome }[]>;

/**
 * Use case: the trierarch plugin prunes each fleet's usage by the fleet's
 * retention (the usage design, "Scale and retention"; decision 0066). Per
 * connected fleet it serves, it reads the days fleet.limits answers its ship
 * and prunes the usage wholly older than that many days; a fleet that keeps
 * its history for good keeps all of it. A fleet switched off is not pruned.
 */
export function createPruneUsage(deps: { door: FleetDoor; connections: ConnectionStore; usage: UsageHistory; isServed: IsServed; clock: Clock }): PruneUsage {
  return async () => {
    const pruned: { fleetId: FleetId; outcome: PruneOutcome }[] = [];
    for (const crew of await deps.connections.connected()) {
      if (!(await deps.isServed(crew.fleetId))) {
        continue;
      }
      const limits = await deps.door.limits(crew.crewToken);
      if (!limits.isOk) {
        pruned.push({ fleetId: crew.fleetId, outcome: { kind: 'refused', refusal: limits.error } });
        continue;
      }
      const { retentionDays } = limits.value;
      if (retentionDays === null) {
        pruned.push({ fleetId: crew.fleetId, outcome: { kind: 'keptForGood' } });
        continue;
      }
      const before = new Date(deps.clock.now().getTime() - retentionDays * DAY_MS);
      await deps.usage.prune(crew.fleetId, before);
      pruned.push({ fleetId: crew.fleetId, outcome: { kind: 'pruned', before } });
    }
    return pruned;
  };
}
