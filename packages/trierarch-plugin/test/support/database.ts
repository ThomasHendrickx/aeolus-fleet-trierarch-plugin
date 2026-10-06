import { migrateDatabase } from '../../src/adapters/prisma/migrate.js';
// The shared Postgres container's URL, which the global setup provides to every file.
import type {} from '../../../core/test/postgres.global-setup.js';
import { createEmptyDatabase } from '../../../core/test/support/database.js';

/** A database of its own in the shared Postgres container, with the trierarch plugin's migrations applied. */
export async function createPluginDatabase(): Promise<string> {
  const databaseUrl = await createEmptyDatabase();
  await migrateDatabase(databaseUrl);
  return databaseUrl;
}
