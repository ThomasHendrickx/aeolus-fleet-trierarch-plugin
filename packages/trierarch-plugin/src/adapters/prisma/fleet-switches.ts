import type { FleetSwitches } from '../../core/installation/ports.js';
import type { Db } from './client.js';

/** Each fleet's switch, one row per fleet. */
export function createPrismaFleetSwitches(db: Db): FleetSwitches {
  return {
    find: async (fleetId) => (await db.fleetSwitch.findUnique({ where: { fleetId } }))?.enabled,
    set: async (fleetId, { isEnabled, at }) => {
      await db.fleetSwitch.upsert({ where: { fleetId }, create: { fleetId, enabled: isEnabled, changedAt: at }, update: { enabled: isEnabled, changedAt: at } });
    },
  };
}
