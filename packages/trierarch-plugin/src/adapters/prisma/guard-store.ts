/** Guard credentials and version compare-and-swap use one transaction, just as MCP configuration does. */
import { guardRulesSchema, idSchema, trierarchGuardRulesMessageSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { GuardAssignments } from '../../core/assignment/ports.js';
import { EMPTY_GUARD_CONFIGURATION } from '../../core/guard/guard-configuration.js';
import type { GuardConfigurations, GuardSnapshots } from '../../core/guard/ports.js';
import type { PrismaClient } from './client.js';

const resolvedSetsSchema = trierarchGuardRulesMessageSchema.shape.sets;
const shipIdSchema = idSchema('ship');
const repositoriesSchema = z.array(z.object({ repository: z.string(), folder: z.string(), access: z.enum(['public', 'private']) }));
const filesSchema = z.array(z.object({ file: z.string(), blob: z.string(), result: z.discriminatedUnion('isOk', [
  z.object({ isOk: z.literal(true), value: z.object({ name: z.string(), rules: guardRulesSchema }) }),
  z.object({ isOk: z.literal(false), error: z.string() }),
]) }));

export function createPrismaGuardStore(db: PrismaClient): GuardConfigurations & GuardSnapshots & GuardAssignments {
  return {
    readPinnedFor: async (fleetId, requests) => {
      if (requests.length === 0) {
        return new Map();
      }
      const rows = await db.guardResolution.findMany({
        where: { fleetId, OR: requests.map(({ shipId, settingsVersion }) => ({ shipId, settingsVersion })) },
        select: { shipId: true, sets: true },
      });
      return new Map(rows.map(({ shipId, sets }) => [shipIdSchema.parse(shipId), resolvedSetsSchema.parse(sets)]));
    },
    pin: async (fleetId, { shipId, settingsVersion, sets }) => {
      const identity = { fleetId, shipId, settingsVersion };
      await db.guardResolution.createMany({ data: [{ ...identity, sets: resolvedSetsSchema.parse(sets) }], skipDuplicates: true });
      const row = await db.guardResolution.findUniqueOrThrow({ where: { fleetId_shipId_settingsVersion: identity }, select: { sets: true } });
      return resolvedSetsSchema.parse(row.sets);
    },
    attempt: async (fleetId, { shipId, settingsVersion, trierarchShipId, idempotencyKey }) => {
      const identity = { fleetId, shipId, settingsVersion, trierarchShipId };
      await db.guardDeliveryAttempt.createMany({ data: [{ ...identity, idempotencyKey }], skipDuplicates: true });
      const row = await db.guardDeliveryAttempt.findUniqueOrThrow({ where: { fleetId_shipId_settingsVersion_trierarchShipId: identity }, select: { idempotencyKey: true } });
      return row.idempotencyKey;
    },
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
    readFailure: async (fleetId, { repository, folder }) => {
      const row = await db.guardReadFailure.findUnique({ where: { fleetId_repository_folder: { fleetId, repository, folder } } });
      return row === null ? undefined : { reason: row.reason, at: row.at };
    },
    fail: async (fleetId, { repository, reason }) => {
      const identity = { fleetId, repository: repository.repository, folder: repository.folder };
      await db.guardReadFailure.upsert({ where: { fleetId_repository_folder: identity }, create: { ...identity, reason }, update: { reason, at: new Date() } });
    },
    save: async (fleetId, snapshot) => {
      const files = z.array(z.json()).parse(snapshot.files);
      const identity = { fleetId, repository: snapshot.repository, folder: snapshot.folder };
      await db.$transaction([
        db.guardSnapshot.upsert({ where: { fleetId_repository_folder: identity }, create: { ...identity, commit: snapshot.commit, files }, update: { commit: snapshot.commit, files } }),
        db.guardReadFailure.deleteMany({ where: identity }),
      ]);
    },
  };
}
