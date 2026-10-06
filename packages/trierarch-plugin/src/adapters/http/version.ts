import { readFileSync } from 'node:fs';

import { z } from 'zod';

const packageJson = z.object({ version: z.string() });

/**
 * The version this trierarch plugin process runs, read from its package.json once:
 * what runs, not what a deploy meant to ship. This file sits at
 * src/adapters/http or dist/adapters/http: the package root is three levels up.
 */
export function runningVersion(): string {
  return packageJson.parse(JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))).version;
}
