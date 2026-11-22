import { createCopyOf, createEmptyDatabase } from '@aeolus-fleet/core/testing';
import { inject } from 'vitest';

import { migrateDatabase } from '../adapters/prisma/migrate.js';

/** The template database this package's test global setup migrates once per Postgres container. */
export const PLUGIN_TEMPLATE = 'aeolus_test_plugin_migrated_template';

declare module 'vitest' {
  export interface ProvidedContext {
    hasPluginTemplate?: boolean;
    postgresUrl: string;
  }
}

/**
 * A database of its own in the shared Postgres container, with the trierarch plugin's migrations applied:
 * a copy of the template this package's global setup migrated. Where that global setup did not run
 * (core's own tests), it creates an empty database and migrates it.
 */
export async function createPluginDatabase(): Promise<string> {
  if (inject('hasPluginTemplate') === true) {
    return createCopyOf(PLUGIN_TEMPLATE);
  }
  const databaseUrl = await createEmptyDatabase();
  await migrateDatabase(databaseUrl);
  return databaseUrl;
}
