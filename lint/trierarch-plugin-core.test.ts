import { describe, expect, it } from 'vitest';

import { createLint, reportsOf } from './support/lint-probe.ts';

// src/core is deterministic, never throws and imports no framework, database
// or adapter (CLAUDE.md, "Architecture rules"; docs/trierarch-plugin.md).

const coreProbe = 'packages/trierarch-plugin/src/core/network/rules-probe.ts';
const coreTestProbe = 'packages/trierarch-plugin/src/core/network/rules-probe.test.ts';
// A file in core but in none of its folders, such as a new one.
const unlistedCoreProbe = 'packages/trierarch-plugin/src/core/rules-probe.ts';
const adapterProbe = 'packages/trierarch-plugin/src/adapters/fleet/rules-probe.ts';
const lint = createLint({
  tsconfig: 'packages/trierarch-plugin/tsconfig.json',
  probes: [coreProbe, coreTestProbe, unlistedCoreProbe, adapterProbe],
});

async function importViolations(code: string, path: string): Promise<string[]> {
  const messages = await lint(code, path);
  return [...reportsOf(messages, 'no-restricted-imports'), ...reportsOf(messages, 'no-restricted-syntax')];
}

describe('the import boundary of src/core', () => {
  it.each([
    ['the Prisma client', "import { PrismaClient } from '@prisma/client';"],
    ['the Prisma pg adapter', "import { PrismaPg } from '@prisma/adapter-pg';"],
    ['the Prisma config', "import { defineConfig } from 'prisma/config';"],
    ['a Prisma type only', "import type { PrismaClient } from '@prisma/client';"],
    ['pg', "import pg from 'pg';"],
    ['Fastify', "import Fastify from 'fastify';"],
    ['a Fastify plugin', "import cors from '@fastify/cors';"],
    ['the tRPC server', "import { initTRPC } from '@trpc/server';"],
    ['an adapter by relative path', "import { createPrismaClient } from '../../adapters/prisma/client.js';"],
    ['the generated Prisma client', "import { PrismaClient } from '../../adapters/prisma/generated/client.js';"],
    ['Aeolus core', "import type { AppRouter } from '@aeolus-fleet/core';"],
    ["Aeolus core's test support", "import { createApp } from '@aeolus-fleet/core/testing';"],
    ['a re-export of Prisma', "export { PrismaClient } from '@prisma/client';"],
    ['Prisma through import()', "export const load = () => import('@prisma/client');"],
    ['Prisma through an import type', "export type Client = import('@prisma/client').PrismaClient;"],
  ])('refuses %s', async (_label, code) => {
    const violations = await importViolations(code, coreProbe);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('src/core must not import ');
  });

  it('refuses Prisma in a core file outside its folders, naming it', async () => {
    await expect(importViolations("import { PrismaClient } from '@prisma/client';", unlistedCoreProbe)).resolves.toEqual([
      expect.stringContaining('must not import Prisma'),
    ]);
  });

  it.each([
    ['another core module', "import type { Clock } from '../shared/clock.js';"],
    ['common', "import { SCOPES } from '@aeolus-fleet/common';"],
    ['a Node built-in', "import { inspect } from 'node:util';"],
    ['a package whose name only starts like pg', "import pgp from 'pgp';"],
  ])('allows %s', async (_label, code) => {
    await expect(importViolations(code, coreProbe)).resolves.toEqual([]);
  });

  it('allows an adapter Fastify and Aeolus core', async () => {
    const code = "import Fastify from 'fastify';\nimport { createApp } from '@aeolus-fleet/core/testing';";

    await expect(importViolations(code, adapterProbe)).resolves.toEqual([]);
  });
});

const impurities = [
  { label: 'Date.now()', code: 'export const now = Date.now();', rule: 'no-restricted-properties', says: 'never reads the clock' },
  { label: 'new Date()', code: 'export const now = new Date();', rule: 'no-restricted-syntax', says: 'never reads the clock' },
  { label: 'Date()', code: 'export const now = Date();', rule: 'no-restricted-syntax', says: 'never reads the clock' },
  { label: 'Math.random()', code: 'export const roll = Math.random();', rule: 'no-restricted-properties', says: 'never makes randomness' },
  { label: 'the crypto global', code: 'export const id = crypto.randomUUID();', rule: 'no-restricted-globals', says: 'never uses crypto' },
  {
    label: 'globalThis.crypto',
    code: 'export const id = globalThis.crypto.randomUUID();',
    rule: 'no-restricted-properties',
    says: 'never uses crypto',
  },
  {
    label: 'node:crypto',
    code: "import { randomBytes } from 'node:crypto';\nexport const token = randomBytes(32);",
    rule: 'no-restricted-imports',
    says: 'never uses crypto',
  },
  {
    label: 'crypto',
    code: "import { createHash } from 'crypto';\nexport const hash = createHash('sha256');",
    rule: 'no-restricted-imports',
    says: 'never uses crypto',
  },
  {
    label: 'a throw',
    code: "export function refuse(): never {\n  throw new Error('refused');\n}\n",
    rule: 'no-restricted-syntax',
    says: 'never throws: return a Result',
  },
];

describe('src/core is deterministic and never throws', () => {
  it.each(impurities)('refuses $label', async ({ code, rule, says }) => {
    expect(reportsOf(await lint(code, coreProbe), rule)).toEqual([expect.stringContaining(`src/core ${says}`)]);
  });

  it.each(impurities)('refuses $label in a core test too', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, coreTestProbe), rule)).toHaveLength(1);
  });

  it.each(impurities)('refuses $label in a core file outside its folders', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, unlistedCoreProbe), rule)).toHaveLength(1);
  });

  it('allows a date built from a time it was given', async () => {
    const messages = await lint('export const later = (at: Date) => new Date(at.getTime() + 1);', coreProbe);

    expect(reportsOf(messages, 'no-restricted-syntax')).toEqual([]);
  });

  it.each(impurities)('allows $label in an adapter', async ({ code, rule }) => {
    expect(reportsOf(await lint(code, adapterProbe), rule)).toEqual([]);
  });
});
