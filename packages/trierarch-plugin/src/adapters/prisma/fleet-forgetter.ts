import type { FleetForgetter } from '../../core/installation/ports.js';
import type { PrismaClient } from './client.js';

/** Forgets every record the trierarch plugin holds of a fleet, in one transaction: its connection, its switch and the requests that name it. */
export function createPrismaFleetForgetter(db: PrismaClient): FleetForgetter {
  return {
    forget: async (fleetId) => {
      const where = { where: { fleetId } };
      await db.$transaction([db.connection.deleteMany(where), db.fleetSwitch.deleteMany(where), db.installationRequest.deleteMany(where)]);
    },
  };
}
