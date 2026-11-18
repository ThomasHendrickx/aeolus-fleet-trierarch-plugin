import { describe, expect, it } from 'vitest';

import { type CommitStatus, stagingWalkVerdict } from './staging-walk-gate.ts';

const SHA = '2008806c3eb14be4b6c3fae7fefdfdb9c4969453';
const VERSION = '0.42.0';
const RUN = '1001';
const WALK_URL = 'https://claude.ai/artifact/walk';

function aStatus(status: Partial<CommitStatus> = {}): CommitStatus {
  return { context: 'staging-walk', state: 'success', target_url: WALK_URL, description: `${VERSION}: passed, candidate run ${RUN}`, ...status };
}

function verdict(release: { statuses?: CommitStatus[]; version?: string; candidateRunId?: string } = {}) {
  return stagingWalkVerdict({ sha: SHA, version: VERSION, candidateRunId: RUN, statuses: [aStatus()], ...release });
}

describe('the staging walk gate', () => {
  it('lets a commit whose staging walk passed be released', () => {
    expect(verdict()).toEqual({ verdict: 'walked', url: WALK_URL });
  });

  it('refuses a commit the walker has not reported on', () => {
    expect(verdict({ statuses: [] })).toEqual({ verdict: 'refused', why: `No staging walk of candidate run ${RUN} at ${VERSION} on ${SHA}: the walker has not reported on it` });
  });

  it('refuses a commit whose staging walk failed, linking the walk', () => {
    expect(verdict({ statuses: [aStatus({ state: 'failure' })] })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} at ${VERSION} did not pass (failure): ${WALK_URL}`,
    });
  });

  it('refuses a commit whose staging walk is still pending', () => {
    expect(verdict({ statuses: [aStatus({ state: 'pending' })] })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} at ${VERSION} did not pass (pending): ${WALK_URL}`,
    });
  });

  it('reads only the staging-walk status, not other checks on the commit', () => {
    expect(verdict({ statuses: [aStatus({ context: 'ci/other', state: 'success' })] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} at ${VERSION} on ${SHA}: the walker has not reported on it`,
    });
  });

  it('refuses a candidate whose own walk is missing when another candidate of the same commit passed', () => {
    const statuses = [aStatus({ description: `${VERSION}: passed, candidate run 2002` })];
    expect(verdict({ statuses })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} at ${VERSION} on ${SHA}: the walker has not reported on it`,
    });
  });

  it('lets the candidate whose own walk passed be released when two candidates of one commit were walked', () => {
    const statuses = [aStatus({ state: 'failure', description: `${VERSION}: blocked, candidate run 2002` }), aStatus()];
    expect(verdict({ statuses })).toEqual({ verdict: 'walked', url: WALK_URL });
  });

  it('refuses a candidate when the passed walk covered another version of the same commit', () => {
    const statuses = [aStatus({ description: `0.41.9: passed, candidate run ${RUN}` })];
    expect(verdict({ statuses })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} at ${VERSION} on ${SHA}: the walker has not reported on it`,
    });
  });

  it('refuses a walk whose state is success but whose description says it was blocked', () => {
    const statuses = [aStatus({ description: `${VERSION}: blocked, candidate run ${RUN}` })];
    expect(verdict({ statuses })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} at ${VERSION} did not pass (blocked): ${WALK_URL}`,
    });
  });

  it('refuses a walk whose description names no candidate run', () => {
    expect(verdict({ statuses: [aStatus({ description: `${VERSION}: passed` })] })).toEqual({
      verdict: 'refused',
      why: `No staging walk of candidate run ${RUN} at ${VERSION} on ${SHA}: the walker has not reported on it`,
    });
  });

  it('judges by the newest staging walk, so a failed walk after a pass refuses', () => {
    const statuses = [aStatus({ state: 'failure', target_url: 'https://claude.ai/artifact/second' }), aStatus()];
    expect(verdict({ statuses })).toEqual({
      verdict: 'refused',
      why: `The staging walk of candidate run ${RUN} at ${VERSION} did not pass (failure): https://claude.ai/artifact/second`,
    });
  });

});
