import { coreVersionRefusal, type VersionFetch } from '@aeolus-fleet/common';

import { ConfigError } from '../../config.js';
import { runningVersion } from '../http/version.js';

/** The oldest core the trierarch plugin runs against (decision 0049, docs/compatibility.md). */
export const MINIMUM_CORE_VERSION = '0.32.0';

/** How long the start waits for a core that does not answer, such as one restarting beside it. */
const CORE_WAIT_MS = 60_000;
const CORE_RETRY_INTERVAL_MS = 2_000;

/** The refusal's wording when core did not say its version, as opposed to saying one that is too old. */
const UNREAD_MARKER = 'could not read the version';

/** What the check reads the version with and waits on; tests replace them. */
export interface CoreVersionOptions {
  readonly fetch?: VersionFetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Stops the start when the fleet's core is older than the trierarch plugin needs. A core that does not say its
 * version (down, or answering HTTP 502 while it restarts) is waited for up to a minute, then refused.
 */
export async function requireCoreVersion(fleetUrl: string, options: CoreVersionOptions = {}): Promise<void> {
  const { fetch = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  const deadline = now() + CORE_WAIT_MS;
  for (;;) {
    const refusal = await coreVersionRefusal({ packageName: 'trierarch-plugin', version: runningVersion(), minimum: MINIMUM_CORE_VERSION, fleetUrl, fetch });
    if (refusal === undefined) {
      return;
    }
    if (!refusal.includes(UNREAD_MARKER) || now() + CORE_RETRY_INTERVAL_MS > deadline) {
      throw new ConfigError(refusal);
    }
    await sleep(CORE_RETRY_INTERVAL_MS);
  }
}
