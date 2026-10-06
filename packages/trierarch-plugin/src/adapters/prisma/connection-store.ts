import { idSchema } from '@aeolus-fleet/common';

import type { ConnectionStore, PluginCrew } from '../../core/connection/ports.js';
import type { Db } from './client.js';

interface Row {
  fleetId: string;
  shipId: string;
  shipName: string;
  crewToken: string | null;
  crewedAt: Date;
}

function crewOf(row: Row): PluginCrew | undefined {
  return row.crewToken
    ? { fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId), name: row.shipName, crewToken: row.crewToken, crewedAt: row.crewedAt }
    : undefined;
}

/** Each fleet's connection, one row per fleet. */
export function createPrismaConnectionStore(db: Db): ConnectionStore {
  return {
    find: async (fleetId) => {
      const row = await db.connection.findUnique({ where: { fleetId } });
      return row ? crewOf(row) : undefined;
    },
    binding: async (fleetId) => {
      const row = await db.connection.findUnique({ where: { fleetId } });
      return row ? { fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId) } : undefined;
    },
    connected: async () => (await db.connection.findMany({ where: { crewToken: { not: null } }, orderBy: { fleetId: 'asc' } })).flatMap((row) => crewOf(row) ?? []),
    save: async ({ fleetId, shipId, name, crewToken, crewedAt }) => {
      const columns = { shipId, shipName: name, crewToken, crewedAt };
      await db.connection.upsert({ where: { fleetId }, create: { fleetId, ...columns }, update: columns });
    },
    drop: async (fleetId) => {
      await db.connection.updateMany({ where: { fleetId }, data: { crewToken: null } });
    },
  };
}
