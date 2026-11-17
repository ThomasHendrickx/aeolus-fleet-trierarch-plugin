import type { PluginDispatchReservations } from '@aeolus-fleet/common/plugin-server';

import type { PrismaClient } from './client.js';

/** The unique key admits exactly one dispatch, even after a restart. */
export function createPrismaPluginReservations(db: PrismaClient): PluginDispatchReservations {
  return {
    reserve: async ({ fleetId, pluginShipId, requestId, expiresAt }) => {
      const inserted = await db.pluginDispatchReservation.createMany({ data: [{ fleetId, pluginShipId, requestId, expiresAt: new Date(expiresAt) }], skipDuplicates: true });
      return inserted.count === 1;
    },
  };
}
