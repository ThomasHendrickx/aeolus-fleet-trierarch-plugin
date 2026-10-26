import type { VersionFetch } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { ConfigError } from '../../config.js';
import { requireCoreVersion } from './core-version.js';

/** A core that answers `/api/version` with this server version. */
function aCoreAt(server: string): VersionFetch {
  return () => Promise.resolve({ status: 200, json: () => Promise.resolve({ server, common: server }) });
}

/** A fleet clock the wait advances by sleeping, so no test really waits. */
function aFleetClock(): { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> } {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: (ms) => {
      elapsed += ms;
      return Promise.resolve();
    },
  };
}

/** A core that answers each call with the next of these (a server version, `restarting` for HTTP 502 or `unreachable`), the last one for every call after. */
function aCoreAnswering(...answers: readonly string[]): { readonly fetch: VersionFetch; readonly calls: () => number } {
  let calls = 0;
  const fetch: VersionFetch = () => {
    const answer = answers[Math.min(calls, answers.length - 1)] ?? 'unreachable';
    calls += 1;
    if (answer === 'unreachable') {
      return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4000'));
    }
    if (answer === 'restarting') {
      return Promise.resolve({ status: 502, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ server: answer, common: answer }) });
  };
  return { fetch, calls: () => calls };
}

describe('the trierarch plugin starts only against a core it runs with (decision 0049)', () => {
  it('starts against a core at its minimum', async () => {
    await expect(requireCoreVersion('https://fleet.example', { fetch: aCoreAt('0.32.0') })).resolves.toBeUndefined();
  });

  it('refuses to start against an older core, naming the trierarch plugin and both versions', async () => {
    await expect(requireCoreVersion('https://fleet.example', { fetch: aCoreAt('0.31.0') })).rejects.toThrow(
      new ConfigError('trierarch-plugin 0.0.0 needs core 0.32.0 or later; the fleet at https://fleet.example runs core 0.31.0: upgrade core first'),
    );
  });

  it('refuses to start when the fleet does not answer', async () => {
    const down: VersionFetch = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:4000'));
    await expect(requireCoreVersion('https://fleet.example', { fetch: down, ...aFleetClock() })).rejects.toThrow(
      new ConfigError('trierarch-plugin 0.0.0 needs core 0.32.0 or later, and could not read the version of the fleet at https://fleet.example: connect ECONNREFUSED 127.0.0.1:4000'),
    );
  });

  it('starts once a core that was restarting answers its version', async () => {
    const core = aCoreAnswering('restarting', 'unreachable', '0.32.0');
    await expect(requireCoreVersion('https://fleet.example', { fetch: core.fetch, ...aFleetClock() })).resolves.toBeUndefined();
    expect(core.calls()).toBe(3);
  });

  it('refuses after the wait runs out, saying why the version could not be read', async () => {
    const core = aCoreAnswering('restarting');
    await expect(requireCoreVersion('https://fleet.example', { fetch: core.fetch, ...aFleetClock() })).rejects.toThrow(
      new ConfigError('trierarch-plugin 0.0.0 needs core 0.32.0 or later, and could not read the version of the fleet at https://fleet.example: HTTP 502'),
    );
    expect(core.calls()).toBeGreaterThan(1);
  });

  it('waits about a minute before it gives up', async () => {
    const clock = aFleetClock();
    await expect(requireCoreVersion('https://fleet.example', { fetch: aCoreAnswering('restarting').fetch, ...clock })).rejects.toThrow(ConfigError);
    expect(clock.now()).toBeGreaterThanOrEqual(60_000);
    expect(clock.now()).toBeLessThan(70_000);
  });

  it('refuses at once on a version it read as too old, without waiting', async () => {
    const core = aCoreAnswering('0.29.2');
    await expect(requireCoreVersion('https://fleet.example', { fetch: core.fetch, ...aFleetClock() })).rejects.toThrow(ConfigError);
    expect(core.calls()).toBe(1);
  });
});
