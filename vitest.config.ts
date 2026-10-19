import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

/**
 * Core's Postgres global setup, by its file: vitest loads a global setup
 * outside the test environment, where a package export does not resolve.
 */
const postgresGlobalSetup = fileURLToPath(
  new URL('node_modules/@aeolus-fleet/core/dist/testing/postgres-global-setup.js', import.meta.url),
);

/**
 * The layers in the order a full run takes them, as each project's name ends
 * (`trierarch-plugin:integration`). CI runs each layer as its own job; a full
 * local run takes them one after another too, so no layer's time limits
 * compete with another layer's servers and databases on the same machine.
 */
const LAYERS = ['unit', 'integration'];

function inLayerOrder(projects: TestProjectInlineConfiguration[]): TestProjectInlineConfiguration[] {
  return projects.map(withGroupOrder);
}

function withGroupOrder(project: TestProjectInlineConfiguration): TestProjectInlineConfiguration {
  const name = project.test?.name;
  const label = typeof name === 'object' ? name.label : (name ?? '');
  const groupOrder = LAYERS.indexOf(label.split(':').at(-1) ?? '');
  if (groupOrder === -1) {
    throw new Error(`the Vitest project ${label} is in no layer: name it <package>:<${LAYERS.join('|')}>`);
  }
  return { ...project, test: { ...project.test, sequence: { ...project.test?.sequence, groupOrder } } };
}

// No @aeolus-fleet/source condition, unlike in tsconfig.base.json: the
// published @aeolus-fleet/common lists it first and ships no src, so Node
// would load its missing source under core's build. TypeScript falls through
// to dist; Node does not. Nothing here imports this package by its name.
export default defineConfig({
  test: {
    // Half the machine per run: the tests start servers and databases beside
    // their workers, and other runs share the machine.
    maxWorkers: '50%',
    // A poll's own default (1 second) holds only on an idle machine.
    expect: { poll: { timeout: 10_000 } },
    projects: inLayerOrder([
      {
        extends: true,
        test: {
          name: 'scripts:unit',
          include: ['scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Each guardrail lint rule, proven against the real ESLint config.
          name: 'lint:unit',
          include: ['lint/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'trierarch-plugin:unit',
          root: 'packages/trierarch-plugin',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // The trierarch plugin on Postgres, against a real fleet server, both in the shared container.
          name: 'trierarch-plugin:integration',
          root: 'packages/trierarch-plugin',
          include: ['test/**/*.integration.test.ts'],
          globalSetup: [postgresGlobalSetup],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ]),
  },
});
