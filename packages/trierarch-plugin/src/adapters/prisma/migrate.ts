/**
 * Applies the migrations this package ships to the database, with Prisma
 * Migrate (`prisma migrate deploy`), from wherever the package is installed.
 * Prisma Migrate holds a Postgres advisory lock while it migrates: two
 * processes starting at once never migrate at once; the second waits, then
 * finds nothing left to apply. Prisma itself waits for that lock only 10
 * seconds, so a migrate that times out on it starts again: it waits as long
 * as the migrate in progress takes.
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

/** Prisma Migrate's account of a wait for its advisory lock that ran out. */
const LOCK_TIMED_OUT = 'Timed out trying to acquire a postgres advisory lock';

/** Migrates the database. Throws a MigrationError holding Prisma's own account when it fails. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  for (;;) {
    const { code, output } = await deploy(databaseUrl);
    if (code === 0) {
      return;
    }
    if (!output.includes(LOCK_TIMED_OUT)) {
      throw new MigrationError(`The database could not be migrated. Prisma Migrate says:\n${output.trim()}`);
    }
  }
}

async function deploy(databaseUrl: string): Promise<{ code: number | null; output: string }> {
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
  return { code, output };
}
