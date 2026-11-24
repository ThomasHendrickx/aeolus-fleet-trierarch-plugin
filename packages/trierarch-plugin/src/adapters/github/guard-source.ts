/** GitHub is the sole credential destination. Upstream failures become fixed public reasons, never response bodies. */
import type { FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { GuardConfigurations, GuardRepository, GuardSource } from '../../core/guard/ports.js';
import { err, ok } from '../../core/shared/result.js';

const REQUEST_TIMEOUT_MS = 10_000;
const commitsSchema = z.array(z.object({ sha: z.string().min(1) })).min(1);
const treeSchema = z.object({ truncated: z.literal(false), tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })) });
const blobSchema = z.object({ encoding: z.literal('base64'), content: z.string() });

export function createGithubGuardSource(deps: { configurations: Pick<GuardConfigurations, 'readConfiguration'>; fetch: typeof globalThis.fetch }): GuardSource {
  const read = async (fleetId: FleetId, input: { repository: GuardRepository; path: string }): Promise<unknown> => {
    const { repository, path } = input;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (repository.access === 'private') {
      const configuration = await deps.configurations.readConfiguration(fleetId);
      const token = configuration.secrets.find(({ name }) => name === repository.repository)?.value;
      if (token === undefined) { return undefined; }
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await deps.fetch(`https://api.github.com/repos/${repository.repository}/${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return response.ok ? response.json() : undefined;
  };
  return {
    latest: async (fleetId, repository) => {
      const response = commitsSchema.safeParse(await read(fleetId, { repository, path: 'commits?per_page=1' }).catch(() => undefined));
      const commit = response.success ? response.data[0]?.sha : undefined;
      return commit === undefined ? err('repository unavailable') : ok(commit);
    },
    tree: async (fleetId, { repository, commit }) => {
      const response = treeSchema.safeParse(await read(fleetId, { repository, path: `git/trees/${encodeURIComponent(commit)}?recursive=1` }).catch(() => undefined));
      if (!response.success) { return err('repository tree unavailable'); }
      const prefix = repository.folder === '' ? '' : `${repository.folder.replace(/\/$/, '')}/`;
      return ok(response.data.tree.filter(({ path, type }) => type === 'blob' && path.startsWith(prefix) && path.endsWith('.yaml')).map(({ path, sha }) => ({ file: path, blob: sha })));
    },
    read: async (fleetId, { repository, blob }) => {
      const response = blobSchema.safeParse(await read(fleetId, { repository, path: `git/blobs/${encodeURIComponent(blob)}` }).catch(() => undefined));
      return response.success ? ok(Buffer.from(response.data.content, 'base64').toString('utf8')) : err('rule set file unavailable');
    },
  };
}
