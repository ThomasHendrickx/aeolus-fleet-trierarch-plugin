import { TRIERARCH_USAGE_CONTENT_TYPE, trierarchUsageMessageSchema, type FleetId, type TrierarchUsageMessage } from '@aeolus-fleet/common';

import type { PluginDelivery } from '../connection/ports.js';
import { TRIERARCH_TYPE } from '../machines/join-machine.js';
import type { UsageHistory } from './ports.js';
import type { UsageReading } from './usage-reading.js';

/** What became of a delivery: not usage, left to the rest of the ship; usage kept; or usage not handled, and why. */
export type KeptUsage = { readonly kind: 'notUsage' } | { readonly kind: 'kept' } | { readonly kind: 'notHandled'; readonly reason: string };

export type KeepUsage = (fleetId: FleetId, delivery: PluginDelivery) => Promise<KeptUsage>;

/** The message's JSON, or undefined when the payload is no JSON. */
function jsonOf(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** The message as the usage history keeps it: each ship's hour per model, as the sending machine's. */
function readingOf(machineShipId: PluginDelivery['senderShipId'], message: TrierarchUsageMessage): UsageReading {
  return {
    machineShipId,
    readAt: new Date(message.readAt),
    hours: message.hours.flatMap(({ hour, ships }) =>
      ships.flatMap(({ shipId, harness, folderMadeAt, login, models }) =>
        models.map(({ model, tokens, estimatedCostUsd }) => ({ hour: new Date(hour), shipId, folderMadeAt: new Date(folderMadeAt), model, harness, login, tokens, estimatedCostUsd })),
      ),
    ),
    subscriptions: message.subscriptions.map(({ harness, readAt, windows }) => ({
      harness,
      readAt: new Date(readAt),
      windows: windows.map(({ windowMinutes, usedPercent, resetsAt }) => ({ windowMinutes, usedPercent, resetsAt: new Date(resetsAt) })),
    })),
  };
}

/**
 * Use case: the trierarch plugin keeps the usage a trierarch sends its ship
 * (the usage design, "What the trierarch plugin stores"). Only from a ship of
 * type trierarch, the type the fleet read, and only as common's usage message;
 * anything else is not handled and keeps nothing. The machine is the sender.
 * The usage history keeps the newest reading per hour row, so a delivery
 * handed again keeps the same rows. A store that fails rejects, so the
 * delivery is not acked and is handed again.
 */
export function createKeepUsage(deps: { usage: UsageHistory }): KeepUsage {
  return async (fleetId, delivery) => {
    if (delivery.contentType !== TRIERARCH_USAGE_CONTENT_TYPE) {
      return { kind: 'notUsage' };
    }
    if (delivery.senderType !== TRIERARCH_TYPE) {
      return { kind: 'notHandled', reason: 'its sender is not a trierarch ship' };
    }
    const parsed = trierarchUsageMessageSchema.safeParse(jsonOf(delivery.payload));
    if (!parsed.success) {
      return { kind: 'notHandled', reason: `it is not a usage message: ${parsed.error.message}` };
    }
    await deps.usage.record(fleetId, readingOf(delivery.senderShipId, parsed.data));
    return { kind: 'kept' };
  };
}
