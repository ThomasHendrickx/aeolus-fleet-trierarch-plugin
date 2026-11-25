import type { FleetForgetter } from '../../core/installation/ports.js';
import type { PrismaClient } from './client.js';

/** Forgets every record the trierarch plugin holds of a fleet, in one transaction: its connection, its switch, its enabled models, its usage history, its MCP configuration with its secrets, events and deliveries, and the requests that name it. */
export function createPrismaFleetForgetter(db: PrismaClient): FleetForgetter {
  return {
    forget: async (fleetId) => {
      const where = { where: { fleetId } };
      await db.$transaction([db.guardDeliveryAttempt.deleteMany(where), db.guardResolution.deleteMany(where), db.guardSecret.deleteMany(where), db.guardConfiguration.deleteMany(where), db.guardSnapshot.deleteMany(where), db.guardReadFailure.deleteMany(where), db.pluginDispatchReservation.deleteMany(where), db.repositoryList.deleteMany(where), db.repositoryEvent.deleteMany(where), db.connection.deleteMany(where), db.fleetSwitch.deleteMany(where), db.enabledModel.deleteMany(where), db.usageHour.deleteMany(where), db.usageDay.deleteMany(where), db.subscriptionReading.deleteMany(where), db.mcpConfiguration.deleteMany(where), db.mcpSecret.deleteMany(where), db.mcpConfigurationEvent.deleteMany(where), db.mcpDelivery.deleteMany(where), db.installationRequest.deleteMany(where)]);
    },
  };
}
