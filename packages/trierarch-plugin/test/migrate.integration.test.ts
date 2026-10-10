import { describe, expect, it } from 'vitest';

// The shared Postgres container's URL, which the global setup provides to every file.
import type {} from '../../core/test/postgres.global-setup.js';
import { createEmptyDatabase } from '../../core/test/support/database.js';
import { migrateWhileAnotherHoldsTheLock } from '../../core/test/support/migrate-lock.js';
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
