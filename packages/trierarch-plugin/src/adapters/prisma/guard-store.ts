/** Guard credentials and version compare-and-swap use one transaction, just as MCP configuration does. */
import { z } from 'zod';

import { EMPTY_GUARD_CONFIGURATION } from '../../core/guard/guard-configuration.js';
import type { GuardConfigurations, GuardSnapshots } from '../../core/guard/ports.js';
import type { PrismaClient } from './client.js';

const repositoriesSchema = z.array(z.object({ repository: z.string(), folder: z.string(), access: z.enum(['public', 'private']) }));
const filesSchema = z.array(z.object({ file: z.string(), blob: z.string(), result: z.discriminatedUnion('isOk', [
  z.object({ isOk: z.literal(true), value: z.object({ name: z.string(), rules: z.record(z.string(), z.unknown()) }) }),
  z.object({ isOk: z.literal(false), error: z.string() }),
]) }));

export function createPrismaGuardStore(db: PrismaClient): GuardConfigurations & GuardSnapshots {
  return {
    readConfiguration: async (fleetId) => {
      const [row, secrets] = await db.$transaction([
        db.guardConfiguration.findUnique({ where: { fleetId } }),
        db.guardSecret.findMany({ where: { fleetId }, select: { name: true, value: true } }),
      ], { isolationLevel: 'RepeatableRead' });
      return row === null ? EMPTY_GUARD_CONFIGURATION : { version: row.version, repositories: repositoriesSchema.parse(row.repositories), floor: row.floor, secrets };
    },
    replace: (fleetId, { expectedVersion, configuration }) => db.$transaction(async (tx) => {
      const data = { version: configuration.version, repositories: configuration.repositories.map((entry) => ({ ...entry })), floor: [...configuration.floor] };
      const moved = expectedVersion === 0
        ? await tx.guardConfiguration.createMany({ data: [{ fleetId, ...data }], skipDuplicates: true })
        : await tx.guardConfiguration.updateMany({ where: { fleetId, version: expectedVersion }, data });
      if (moved.count === 0) { return 'conflict'; }
      await tx.guardSecret.deleteMany({ where: { fleetId } });
      await tx.guardSecret.createMany({ data: configuration.secrets.map(({ name, value }) => ({ fleetId, name, value })) });
      return 'replaced';
    }),
    read: async (fleetId, { repository, folder }) => {
      const row = await db.guardSnapshot.findUnique({ where: { fleetId_repository_folder: { fleetId, repository, folder } } });
      return row === null ? undefined : { repository, folder, commit: row.commit, files: filesSchema.parse(row.files) };
    },
    save: async (fleetId, snapshot) => {
      const files = z.array(z.json()).parse(snapshot.files);
      await db.guardSnapshot.upsert({ where: { fleetId_repository_folder: { fleetId, repository: snapshot.repository, folder: snapshot.folder } }, create: { fleetId, repository: snapshot.repository, folder: snapshot.folder, commit: snapshot.commit, files }, update: { commit: snapshot.commit, files } });
    },
  };
}
