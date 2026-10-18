import { createEmptyDatabase } from '@aeolus-fleet/core/testing';

import { migrateDatabase } from '../adapters/prisma/migrate.js';

/** A database of its own in the shared Postgres container, with the trierarch plugin's migrations applied. */
export async function createPluginDatabase(): Promise<string> {
  const databaseUrl = await createEmptyDatabase();
  await migrateDatabase(databaseUrl);
  return databaseUrl;
}
