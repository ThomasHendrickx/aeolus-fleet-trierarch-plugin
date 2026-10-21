/**
 * Sets the version on this repository's published packages and pins their
 * dependencies on each other to exactly that version, because they are
 * released together. A dependency on another train's package, such as
 * @aeolus-fleet/common or @aeolus-fleet/core, keeps its range: that train has
 * a version of its own (decision 0049). The exports lose the
 * @aeolus-fleet/source condition: it points into src, which the tarball does
 * not ship (aeolus-fleet#968). Used by the release and candidate workflows and
 * the publish dry run in CI.
 *
 * Usage: npm run set-version -- <version>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const PUBLISHED_PACKAGES = ['trierarch-plugin'] as const;

const SCOPE = '@aeolus-fleet/';
const SOURCE_CONDITION = '@aeolus-fleet/source';
const OWN_PACKAGES: readonly string[] = PUBLISHED_PACKAGES.map((name) => SCOPE + name);
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/;

type Dependencies = Record<string, string>;

const dependenciesSchema = z.record(z.string(), z.string()).optional();

/** The fields set-version changes. */
const manifestSchema = z.object({
  version: z.string(),
  dependencies: dependenciesSchema,
  devDependencies: dependenciesSchema,
});

/** The dependencies, with this repository's own packages pinned to the version. */
function pinned(dependencies: Dependencies | undefined, version: string): Dependencies | undefined {
  return (
    dependencies &&
    Object.fromEntries(
      Object.entries(dependencies).map(([name, range]) => [name, OWN_PACKAGES.includes(name) ? version : range]),
    )
  );
}

/** The exports with the source condition removed at every level, everything else in its place. */
function withoutSourceCondition(exports: unknown): unknown {
  const entries = z.record(z.string(), z.unknown()).safeParse(exports);
  if (!entries.success) {
    return exports;
  }
  return Object.fromEntries(
    Object.entries(entries.data)
      .filter(([condition]) => condition !== SOURCE_CONDITION)
      .map(([condition, target]) => [condition, withoutSourceCondition(target)]),
  );
}

export function setVersion(repositoryRoot: string, version: string): void {
  if (!SEMVER.test(version)) {
    throw new Error(`Not a semantic version: "${version}"`);
  }

  for (const name of PUBLISHED_PACKAGES) {
    const path = join(repositoryRoot, 'packages', name, 'package.json');
    // Every field stays where it is; only the version, the pinned dependencies and the exports change.
    const manifest = z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(path, 'utf8')));
    const { dependencies, devDependencies } = manifestSchema.parse(manifest);
    const updated = {
      ...manifest,
      version,
      dependencies: pinned(dependencies, version),
      devDependencies: pinned(devDependencies, version),
      exports: withoutSourceCondition(manifest.exports),
    };

    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  }
}

if (import.meta.main) {
  const version = process.argv[2] ?? '';
  try {
    setVersion(fileURLToPath(new URL('..', import.meta.url)), version);
    console.log(`Set ${OWN_PACKAGES.join(', ')} to ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
