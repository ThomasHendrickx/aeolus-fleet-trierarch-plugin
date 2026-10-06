import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { place, type PlacementRequest, type PlacementTrierarch } from './placement.js';

const EARLY = new Date('2026-10-01T10:00:00.000Z');
const LATER = new Date('2026-10-02T10:00:00.000Z');
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const LOOKOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1b';
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const LINUX: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2b';

/** What a trierarch offers by default: Claude Code with a model option, aeolus-fleet and notes, room for four. */
function details(overrides: Partial<TrierarchReportDetails> = {}): TrierarchReportDetails {
  return {
    harnesses: [
      {
        harness: 'claude-code',
        options: { type: 'object', properties: { model: { enum: ['opus', 'sonnet'], default: 'opus' } }, additionalProperties: false },
        flags: [],
      },
    ],
    workspaces: { repositories: ['aeolus-fleet'], folders: ['notes'] },
    caps: { ships: 4, running: 2 },
    kept: [],
    orphans: [],
    version: '0.19.0',
    ...overrides,
  };
}

function aTrierarch(shipId: ShipId, overrides: Partial<PlacementTrierarch> = {}): PlacementTrierarch {
  return { shipId, commissionedAt: EARLY, details: details(), assigned: 0, ...overrides };
}

function aRequest(shipId: ShipId, settings: Record<string, unknown> = {}, overrides: Partial<PlacementRequest> = {}): PlacementRequest {
  return {
    shipId,
    requestedAt: EARLY,
    settings: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' }, ...settings },
    reason: null,
    ...overrides,
  };
}

describe('placement (docs/trierarch.md, Assignment)', () => {
  it('assigns a request to a trierarch that offers its harness and workspace, takes its options and has room', () => {
    expect(place([aRequest(SCOUT)], [aTrierarch(MAC)])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('assigns a folder request to a trierarch that offers the folder', () => {
    expect(place([aRequest(SCOUT, { workspace: { kind: 'folder', name: 'notes' } })], [aTrierarch(MAC)])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('of several that fit, picks the most room as a percentage of its cap', () => {
    const small = aTrierarch(MAC, { details: details({ caps: { ships: 2, running: 1 } }), assigned: 1 });
    const large = aTrierarch(LINUX, { details: details({ caps: { ships: 8, running: 4 } }), assigned: 2, commissionedAt: LATER });

    expect(place([aRequest(SCOUT)], [small, large])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: LINUX }]);
  });

  it('of several with the same room, picks the oldest', () => {
    const younger = aTrierarch(LINUX, { commissionedAt: LATER });
    const older = aTrierarch(MAC, { commissionedAt: EARLY });

    expect(place([aRequest(SCOUT)], [younger, older])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('serves the oldest request first: it takes the last room', () => {
    const newer = aRequest(LOOKOUT, {}, { requestedAt: LATER });
    const older = aRequest(SCOUT, {}, { requestedAt: EARLY });

    expect(place([newer, older], [aTrierarch(MAC, { assigned: 3 })])).toEqual([
      { kind: 'assign', shipId: SCOUT, trierarchShipId: MAC },
      { kind: 'explain', shipId: LOOKOUT, reason: 'no trierarch with room: all 1 that fit are full' },
    ]);
  });

  it('counts what it assigns in the same pass against the room', () => {
    const first = aRequest(SCOUT, {}, { requestedAt: EARLY });
    const second = aRequest(LOOKOUT, {}, { requestedAt: LATER });
    const mac = aTrierarch(MAC, { details: details({ caps: { ships: 2, running: 1 } }) });
    const linux = aTrierarch(LINUX, { details: details({ caps: { ships: 2, running: 1 } }), commissionedAt: LATER });

    expect(place([first, second], [mac, linux])).toEqual([
      { kind: 'assign', shipId: SCOUT, trierarchShipId: MAC },
      { kind: 'assign', shipId: LOOKOUT, trierarchShipId: LINUX },
    ]);
  });

  it.each([
    ['no trierarch reports', [], {}, 'no trierarch reports yet'],
    ['none offers the harness', [aTrierarch(MAC)], { harness: 'codex' }, 'no trierarch offers harness codex'],
    ['none offering it has the repository', [aTrierarch(MAC)], { workspace: { kind: 'worktree', repository: 'hemma' } }, 'no trierarch offering claude-code has repository hemma'],
    ['none offering it has the folder', [aTrierarch(MAC)], { workspace: { kind: 'folder', name: 'drafts' } }, 'no trierarch offering claude-code has folder drafts'],
    ['none takes the options', [aTrierarch(MAC)], { options: { model: 'haiku' } }, 'no trierarch takes these options for claude-code: options.model: Invalid option: expected one of "opus"|"sonnet"'],
    ['none takes an unknown option', [aTrierarch(MAC)], { options: { effort: 'max' } }, 'no trierarch takes these options for claude-code: options: Unrecognized key: "effort"'],
    ['none has room', [aTrierarch(MAC, { assigned: 4 }), aTrierarch(LINUX, { assigned: 4 })], {}, 'no trierarch with room: all 2 that fit are full'],
  ])('leaves a request unassigned with the reason when %s', (_label, trierarchs, settings, reason) => {
    expect(place([aRequest(SCOUT, settings)], trierarchs)).toEqual([{ kind: 'explain', shipId: SCOUT, reason }]);
  });

  it('leaves a request whose settings are not crew settings unassigned with the reason', () => {
    expect(place([aRequest(SCOUT, { flags: ['--yolo'] })], [aTrierarch(MAC)])).toEqual([{ kind: 'explain', shipId: SCOUT, reason: 'settings are not valid crew settings: Unrecognized key: "flags"' }]);
  });

  it('counts a trierarch whose options schema it cannot read as not taking the options', () => {
    const unreadable = aTrierarch(MAC, { details: details({ harnesses: [{ harness: 'claude-code', options: { type: 'no-such-type' }, flags: [] }] }) });

    expect(place([aRequest(SCOUT)], [unreadable])).toMatchObject([{ kind: 'explain', shipId: SCOUT }]);
  });

  it('does not write a reason again that still holds', () => {
    expect(place([aRequest(SCOUT, { harness: 'codex' }, { reason: 'no trierarch offers harness codex' })], [aTrierarch(MAC)])).toEqual([]);
  });
});
