import type { EnabledModels } from '../../core/models/ports.js';
import type { Db } from './client.js';

/** Each fleet's enabled models, one row per fleet and model id; enabling and disabling are one statement each. */
export function createPrismaEnabledModels(db: Db): EnabledModels {
  return {
    list: async (fleetId) => (await db.enabledModel.findMany({ where: { fleetId }, select: { model: true }, orderBy: { model: 'asc' } })).map((row) => row.model),
    enable: async (fleetId, model) => {
      // Already enabled, by this call or one at the same time, changes nothing.
      await db.enabledModel.createMany({ data: [{ fleetId, model }], skipDuplicates: true });
    },
    disable: async (fleetId, model) => {
      await db.enabledModel.deleteMany({ where: { fleetId, model } });
    },
  };
}
