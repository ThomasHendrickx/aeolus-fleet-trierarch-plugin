import { describe, expect, it } from 'vitest';

import { createEmptyDatabase, migrateWhileAnotherHoldsTheLock } from '@aeolus-fleet/core/testing';

import { migrateDatabase } from '../src/adapters/prisma/migrate.js';

// Migrating the trierarch plugin's database while another migrate holds it, as two
// processes starting at once do.

describe('migrating the database', () => {
  it('waits for a migrate in progress however long it takes, then migrates', async () => {
    const databaseUrl = await createEmptyDatabase();

    const { releasedAt, finishedAt } = await migrateWhileAnotherHoldsTheLock(databaseUrl, () => migrateDatabase(databaseUrl));

    expect(finishedAt).toBeGreaterThan(releasedAt);
  }, 90_000);
});
