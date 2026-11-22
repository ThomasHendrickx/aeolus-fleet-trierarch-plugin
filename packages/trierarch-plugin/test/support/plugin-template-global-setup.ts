import { databaseUrlOf } from '@aeolus-fleet/core/testing';
import type { TestProject } from 'vitest/node';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { migrateDatabase } from '../../src/adapters/prisma/migrate.js';
import { PLUGIN_TEMPLATE } from '../../src/testing/database.js';

/**
 * Migrates the trierarch plugin's schema once into a template database in core's shared
 * Postgres, after core's global setup started it. Each test's database is a copy of it.
 */
export async function setup(project: TestProject): Promise<void> {
  const adminUrl = project.getProvidedContext().postgresUrl;
  const admin = createPrismaClient(adminUrl);
  try {
    // The name is a constant of this package, never outside input.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${PLUGIN_TEMPLATE}`);
  } finally {
    await admin.$disconnect();
  }
  await migrateDatabase(databaseUrlOf(adminUrl, PLUGIN_TEMPLATE));
  project.provide('hasPluginTemplate', true);
}
