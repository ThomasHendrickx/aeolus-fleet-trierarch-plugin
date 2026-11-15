/**
 * CI check: a test job leaves no container and no volume behind, also when a
 * test failed or the job was interrupted (aeolus-fleet#1581). It runs after the
 * job, on a runner that had neither before it, so each one it finds is the
 * job's. Core's global setup starts a sweeper that removes a run's containers
 * only after the run's process ended, so the check waits for it.
 *
 * Usage: node scripts/check-test-run-leftovers.ts
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { getContainerRuntimeClient } from 'testcontainers';

/** The label core's global setup puts on every container of a run, its value the run. */
export const TEST_RUN_LABEL = 'aeolus-fleet.test-run';

/** How long the check waits for a sweeper to finish. */
const SWEEP_WAIT_MS = 30_000;

interface RunContainer {
  Id: string;
  Image: string;
  State: string;
  Labels: Record<string, string>;
}

export function leftoversOf(containers: RunContainer[], unusedVolumes: { Name: string }[]): string[] {
  return [
    ...containers.map((container) => `container ${container.Id} (${container.Image}, ${container.State}) of test run ${container.Labels[TEST_RUN_LABEL] ?? ''}`),
    ...unusedVolumes.map((volume) => `volume ${volume.Name}, used by no container`),
  ];
}

/** What the test runs left on this machine: every container a run started, and every volume no container uses. */
async function testRunLeftovers(): Promise<string[]> {
  const { dockerode } = (await getContainerRuntimeClient()).container;
  const containers = await dockerode.listContainers({ all: true, filters: { label: [TEST_RUN_LABEL] } });
  const { Volumes: volumes } = await dockerode.listVolumes({ filters: { dangling: ['true'] } });
  return leftoversOf(containers, volumes);
}

if (import.meta.main) {
  const deadline = Date.now() + SWEEP_WAIT_MS;
  let leftovers = await testRunLeftovers();
  while (leftovers.length > 0 && Date.now() < deadline) {
    await sleep(1_000);
    leftovers = await testRunLeftovers();
  }
  if (leftovers.length === 0) {
    console.log('The test run left no container and no volume behind.');
  } else {
    console.error(`The test run left ${String(leftovers.length)} behind:`);
    for (const leftover of leftovers) {
      console.error(`- ${leftover}`);
    }
    process.exitCode = 1;
  }
}
