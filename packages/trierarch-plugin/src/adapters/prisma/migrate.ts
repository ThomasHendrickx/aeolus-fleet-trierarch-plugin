/**
 * Applies the migrations this package ships to the database, with Prisma
 * Migrate (`prisma migrate deploy`), from wherever the package is installed.
 * Prisma Migrate holds a Postgres advisory lock while it migrates: two
 * processes starting at once never migrate at once; the second waits, then
 * finds nothing left to apply.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** The package's root, where prisma.config.ts names the schema and the migrations: the same from src and from dist. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const PRISMA_CLI = createRequire(import.meta.url).resolve('prisma/build/index.js');

export class MigrationError extends Error {
  override name = 'MigrationError';
}

/** Migrates the database. Throws a MigrationError holding Prisma's own account when it fails. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const child = spawn(process.execPath, [PRISMA_CLI, 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      // The trierarch plugin never asks Prisma's servers whether a newer version exists.
      CHECKPOINT_DISABLE: '1',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const code = await new Promise<number | null>((resolve) => {
    child.once('close', resolve);
  });
  if (code !== 0) {
    throw new MigrationError(`The database could not be migrated. Prisma Migrate says:\n${output.trim()}`);
  }
}
