import { z } from 'zod';

import type { RepositoryStore } from '../../core/repositories/manage-repositories.js';
import type { PrismaClient } from './client.js';

const repositoriesSchema = z.array(z.object({ name: z.string(), url: z.string() }));

/** Commits the current list and its actor event together under a version guard. */
export function createPrismaRepositories(db: PrismaClient): RepositoryStore {
  return {
    read: async (fleetId) => {
      const row = await db.repositoryList.findUnique({ where: { fleetId } });
      return row ? { version: row.version, repositories: repositoriesSchema.parse(row.repositories) } : { version: 0, repositories: [] };
    },
    save: (fleetId, { expectedVersion, next, event }) => db.$transaction(async (tx) => {
      const repositories = next.repositories.map(({ name, url }) => ({ name, url }));
      const moved = expectedVersion === 0
        ? await tx.repositoryList.createMany({ data: [{ fleetId, version: next.version, repositories }], skipDuplicates: true })
        : await tx.repositoryList.updateMany({ where: { fleetId, version: expectedVersion }, data: { version: next.version, repositories } });
      if (moved.count === 0) return false;
      await tx.repositoryEvent.create({ data: { fleetId, ...event } });
      return true;
    }),
  };
}
