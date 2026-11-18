import type { FleetId } from '@aeolus-fleet/common';
import type { PluginDispatchReservations } from '@aeolus-fleet/common/plugin-server';

import type { PrismaClient } from './client.js';

/** The unique key admits exactly one dispatch, even after a restart. */
export function createPrismaPluginReservations(db: PrismaClient, now: () => Date = () => new Date()): PluginDispatchReservations & { prune(fleetId: FleetId, at: Date): Promise<void> } {
  return {
    prune: async (fleetId, at) => { await db.pluginDispatchReservation.deleteMany({ where: { fleetId, expiresAt: { lte: at } } }); },
    reserve: async ({ fleetId, pluginShipId, requestId, expiresAt }) => {
      await db.pluginDispatchReservation.deleteMany({ where: { fleetId, expiresAt: { lte: now() } } });
      const inserted = await db.pluginDispatchReservation.createMany({ data: [{ fleetId, pluginShipId, requestId, expiresAt: new Date(expiresAt) }], skipDuplicates: true });
      return inserted.count === 1;
    },
  };
}
