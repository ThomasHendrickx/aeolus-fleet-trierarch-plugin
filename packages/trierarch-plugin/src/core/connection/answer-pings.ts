import { isPingContentType, RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import type { KeepUsage } from '../usage/keep-usage.js';
import type { ConnectionStore, PluginDelivery, PluginInbox } from './ports.js';

/**
 * What a round did: pings answered, trierarchs' usage kept, usage not handled
 * and why, other deliveries acked as kept by the fleet, and calls the fleet
 * refused or usage the store failed on, each left to be handed again.
 */
export interface PingRound {
  ponged: number;
  acked: PluginDelivery[];
  keptUsage: number;
  notHandled: { delivery: PluginDelivery; reason: string }[];
  refused: number;
}

export type AnswerPings = () => Promise<PingRound>;

/**
 * Use case: the trierarch plugin's own ship takes what waits for it in each
 * fleet it is connected to, as any crewed ship does (blueprint, "Ping"):
 * argo's ping is answered with pong; a trierarch's usage is kept, then acked,
 * so usage the store fails on is not acked and the fleet hands it again (the
 * usage design); anything else is acked, and the fleet keeps it in its history.
 */
export function createAnswerPings(deps: { connections: ConnectionStore; inbox: PluginInbox; keepUsage: KeepUsage }): AnswerPings {
  return async () => {
    const round: PingRound = { ponged: 0, acked: [], keptUsage: 0, notHandled: [], refused: 0 };
    for (const crew of await deps.connections.connected()) {
      const taken = await deps.inbox.receive(crew.crewToken, RECEIVE_MAX_UPPER_BOUND);
      if (!taken.isOk) {
        round.refused += 1;
        continue;
      }
      for (const delivery of taken.value) {
        if (isPingContentType(delivery.contentType)) {
          const ponged = await deps.inbox.pong(crew.crewToken, delivery.deliveryId);
          round.ponged += ponged.isOk ? 1 : 0;
          round.refused += ponged.isOk ? 0 : 1;
          continue;
        }
        const usage = await deps.keepUsage(crew.fleetId, delivery).catch(() => undefined);
        if (usage === undefined) {
          round.refused += 1;
          continue;
        }
        const acked = await deps.inbox.ack(crew.crewToken, delivery.deliveryId);
        if (!acked.isOk) {
          round.refused += 1;
        } else if (usage.kind === 'kept') {
          round.keptUsage += 1;
        } else if (usage.kind === 'notHandled') {
          round.notHandled.push({ delivery, reason: usage.reason });
        } else {
          round.acked.push(delivery);
        }
      }
    }
    return round;
  };
}
