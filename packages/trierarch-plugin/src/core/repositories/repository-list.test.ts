import { describe, expect, it } from 'vitest';

import { changeRepositoryList } from './repository-list.js';

const empty = { version: 0, repositories: [] };
const main = { name: 'main', url: 'https://example.com/org/repo.git' };

describe('a fleet repository list', () => {
  it('adds a valid repository and advances its version', () => {
    expect(changeRepositoryList(empty, { kind: 'add', ...main, expectedVersion: 0 })).toEqual({ isOk: true, value: { version: 1, repositories: [main] } });
  });

  it('leaves identical additions and absent removals unchanged', () => {
    const current = { version: 1, repositories: [main] };
    expect(changeRepositoryList(current, { kind: 'add', ...main, expectedVersion: 1 })).toEqual({ isOk: true, value: current });
    expect(changeRepositoryList(current, { kind: 'remove', name: 'other', expectedVersion: 1 })).toEqual({ isOk: true, value: current });
  });

  it('refuses stale versions and another URL for an existing name', () => {
    const current = { version: 1, repositories: [main] };
    expect(changeRepositoryList(current, { kind: 'remove', name: 'main', expectedVersion: 0 }).isOk).toBe(false);
    expect(changeRepositoryList(current, { kind: 'add', name: 'main', url: 'https://example.com/other.git', expectedVersion: 1 }).isOk).toBe(false);
  });

  it('refuses URLs with credentials', () => {
    expect(changeRepositoryList(empty, { kind: 'add', name: 'main', url: 'https://secret@example.com/repo.git', expectedVersion: 0 }).isOk).toBe(false);
  });

  it('removes a repository and advances its version', () => {
    expect(changeRepositoryList({ version: 1, repositories: [main] }, { kind: 'remove', name: 'main', expectedVersion: 1 })).toEqual({ isOk: true, value: { version: 2, repositories: [] } });
  });
});
