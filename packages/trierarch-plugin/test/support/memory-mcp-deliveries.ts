import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { McpAttempt, McpDelivery } from '../../src/core/mcp-configuration/mcp-delivery.js';
import type { McpDeliveries } from '../../src/core/mcp-configuration/ports.js';

/** Each fleet's deliveries of its MCP configuration in memory, one per trierarch ship, as the Postgres store keeps them across restarts. */
export function memoryMcpDeliveries(): McpDeliveries & { held: Map<FleetId, Map<ShipId, McpDelivery>> } {
  const held = new Map<FleetId, Map<ShipId, McpDelivery>>();
  const of = (fleetId: FleetId) => {
    const fleet = held.get(fleetId) ?? new Map<ShipId, McpDelivery>();
    held.set(fleetId, fleet);
    return fleet;
  };
  const change = (fleetId: FleetId, trierarchShipId: ShipId, changed: (delivery: McpDelivery) => McpDelivery) => {
    const fleet = of(fleetId);
    fleet.set(trierarchShipId, changed(fleet.get(trierarchShipId) ?? { trierarchShipId, attempt: null, applied: null, isRequested: false }));
    return Promise.resolve();
  };
  return {
    held,
    list: (fleetId) => Promise.resolve([...of(fleetId).values()]),
    recordAttempt: (fleetId, trierarchShipId, attempt: McpAttempt) => change(fleetId, trierarchShipId, (delivery) => ({ ...delivery, attempt, isRequested: false })),
    markSent: (fleetId, trierarchShipId, sent) =>
      change(fleetId, trierarchShipId, (delivery) => (delivery.attempt?.idempotencyKey === sent.idempotencyKey ? { ...delivery, attempt: { ...delivery.attempt, sentAt: sent.at } } : delivery)),
    recordApplied: (fleetId, trierarchShipId, applied) => change(fleetId, trierarchShipId, (delivery) => ({ ...delivery, applied })),
    markRequested: (fleetId, trierarchShipId) => change(fleetId, trierarchShipId, (delivery) => ({ ...delivery, isRequested: true })),
    forget: (fleetId, trierarchShipIds) => {
      for (const shipId of trierarchShipIds) {
        of(fleetId).delete(shipId);
      }
      return Promise.resolve();
    },
  };
}
