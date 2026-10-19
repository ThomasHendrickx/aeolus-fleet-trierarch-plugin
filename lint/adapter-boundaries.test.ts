import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// Prisma and pg live in the Prisma adapter only (CLAUDE.md, "Architecture rules").

const plugin = {
  prisma: 'packages/trierarch-plugin/src/adapters/prisma/boundary-probe.ts',
  http: 'packages/trierarch-plugin/src/adapters/http/boundary-probe.ts',
  test: 'packages/trierarch-plugin/test/boundary-probe.ts',
};
const script = 'scripts/boundary-probe.ts';

// Import rules need no package-specific typing, so every probe is typed with the package's tsconfig.
const lint = createLint({ tsconfig: 'packages/trierarch-plugin/tsconfig.json', probes: [...Object.values(plugin), script] });

async function importViolations(messages: Promise<Parameters<typeof reportsOf>[0]>): Promise<string[]> {
  const reported = await messages;
  return [...reportsOf(reported, 'no-restricted-imports'), ...reportsOf(reported, 'no-restricted-syntax')];
}

const databaseImports = [
  { label: 'the Prisma client', code: "import { PrismaClient } from '@prisma/client';" },
  { label: 'the Prisma pg adapter', code: "import { PrismaPg } from '@prisma/adapter-pg';" },
  { label: 'pg', code: "import pg from 'pg';" },
  { label: 'a pg package', code: "import Pool from 'pg-pool';" },
];

describe('Prisma and pg outside the Prisma adapter', () => {
  it.each(databaseImports)('refuses $label in another adapter', async ({ code }) => {
    await expect(importViolations(lint(code, plugin.http))).resolves.toEqual([
      expect.stringMatching(/is imported only in the prisma adapter \(src\/adapters\/prisma\)/),
    ]);
  });

  it.each(databaseImports)('refuses $label in a test', async ({ code }) => {
    await expect(importViolations(lint(code, plugin.test))).resolves.toHaveLength(1);
  });

  it.each(databaseImports)('refuses $label in scripts', async ({ code }) => {
    await expect(importViolations(lint(code, script))).resolves.toHaveLength(1);
  });

  it.each(databaseImports)('allows $label in the Prisma adapter', async ({ code }) => {
    await expect(importViolations(lint(code, plugin.prisma))).resolves.toEqual([]);
  });

  it('allows the Prisma adapter itself everywhere else', async () => {
    const code = "import { createPrismaClient } from '../src/adapters/prisma/client.js';";

    await expect(importViolations(lint(code, plugin.test))).resolves.toEqual([]);
  });
});
