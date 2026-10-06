import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { InstallationRequests } from '../../core/installation/ports.js';
import type { Db } from './client.js';

const kindSchema = z.enum(['setEnabled', 'deleteFleet']);

/** The installation's requests, by request id. */
export function createPrismaInstallationRequests(db: Db): InstallationRequests {
  return {
    find: async (requestId) => {
      const row = await db.installationRequest.findUnique({ where: { requestId } });
      return row
        ? {
            requestId: row.requestId,
            kind: kindSchema.parse(row.kind),
            requestHash: row.requestHash,
            fleetId: row.fleetId === null ? null : idSchema('fleet').parse(row.fleetId),
            isEnabled: row.enabled,
            at: row.at,
          }
        : undefined;
    },
    record: async ({ requestId, kind, requestHash, fleetId, isEnabled, at }) => {
      await db.installationRequest.create({ data: { requestId, kind, requestHash, fleetId, enabled: isEnabled, at } });
    },
  };
}
