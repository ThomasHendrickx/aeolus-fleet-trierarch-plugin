import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { checkPlacement, place, type PlacementRequest, type PlacementTrierarch } from './placement.js';

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
  return { shipId, commissionedAt: EARLY, details: details(), assigned: 0, labelValueIds: [], ...overrides };
}

const MACOS = 'lbv_01m3tbfspe96yf1rnr4ank9h3a';
const LINUX_OS = 'lbv_01m3tbfspe96yf1rnr4ank9h3b';
const ARM64 = 'lbv_01m3tbfspe96yf1rnr4ank9h3c';

/** A request for a worktree of aeolus-fleet on Claude Code with opus; `settings` changes some of them. */
function aRequest(shipId: ShipId, overrides: Partial<Omit<PlacementRequest, 'settings'>> & { settings?: Record<string, unknown> } = {}): PlacementRequest {
  const { settings = {}, ...rest } = overrides;
  return {
    shipId,
    requestedAt: EARLY,
    reason: null,
    ...rest,
    settings: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' }, ...settings },
  };
}

describe('placement (docs/trierarch.md, Assignment)', () => {
  it('assigns a request to a trierarch that offers its harness and workspace, takes its options and has room', () => {
    expect(place([aRequest(SCOUT)], [aTrierarch(MAC)])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('assigns a folder request to a trierarch that offers the folder', () => {
    expect(place([aRequest(SCOUT, { settings: { workspace: { kind: 'folder', name: 'notes' } } })], [aTrierarch(MAC)])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
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
    const newer = aRequest(LOOKOUT, { requestedAt: LATER });
    const older = aRequest(SCOUT, { requestedAt: EARLY });

    expect(place([newer, older], [aTrierarch(MAC, { assigned: 3 })])).toEqual([
      { kind: 'assign', shipId: SCOUT, trierarchShipId: MAC },
      { kind: 'explain', shipId: LOOKOUT, reason: 'no trierarch with room: all 1 that fit are full' },
    ]);
  });

  it('counts what it assigns in the same pass against the room', () => {
    const first = aRequest(SCOUT, { requestedAt: EARLY });
    const second = aRequest(LOOKOUT, { requestedAt: LATER });
    const mac = aTrierarch(MAC, { details: details({ caps: { ships: 2, running: 1 } }) });
    const linux = aTrierarch(LINUX, { details: details({ caps: { ships: 2, running: 1 } }), commissionedAt: LATER });

    expect(place([first, second], [mac, linux])).toEqual([
      { kind: 'assign', shipId: SCOUT, trierarchShipId: MAC },
      { kind: 'assign', shipId: LOOKOUT, trierarchShipId: LINUX },
    ]);
  });

  it.each([
    { label: 'no trierarch reports', trierarchs: [], settings: {}, reason: 'no trierarch reports yet' },
    { label: 'none offers the harness', trierarchs: [aTrierarch(MAC)], settings: { harness: 'codex' }, reason: 'no trierarch offers harness codex' },
    {
      label: 'none offering it has the repository',
      trierarchs: [aTrierarch(MAC)],
      settings: { workspace: { kind: 'worktree', repository: 'hemma' } },
      reason: 'no trierarch offering claude-code has repository hemma',
    },
    {
      label: 'none offering it has the folder',
      trierarchs: [aTrierarch(MAC)],
      settings: { workspace: { kind: 'folder', name: 'drafts' } },
      reason: 'no trierarch offering claude-code has folder drafts',
    },
    {
      label: 'none takes the options',
      trierarchs: [aTrierarch(MAC)],
      settings: { options: { model: 'haiku' } },
      reason: 'no trierarch takes these options for claude-code: options.model: Invalid option: expected one of "opus"|"sonnet"',
    },
    {
      label: 'none takes an unknown option',
      trierarchs: [aTrierarch(MAC)],
      settings: { options: { effort: 'max' } },
      reason: 'no trierarch takes these options for claude-code: options: Unrecognized key: "effort"',
    },
    { label: 'none has room', trierarchs: [aTrierarch(MAC, { assigned: 4 }), aTrierarch(LINUX, { assigned: 4 })], settings: {}, reason: 'no trierarch with room: all 2 that fit are full' },
  ])('leaves a request unassigned with the reason when $label', ({ trierarchs, settings, reason }) => {
    expect(place([aRequest(SCOUT, { settings })], trierarchs)).toEqual([{ kind: 'explain', shipId: SCOUT, reason }]);
  });

  it('leaves a request whose settings are not crew settings unassigned with the reason', () => {
    expect(place([aRequest(SCOUT, { settings: { flags: ['--yolo'] } })], [aTrierarch(MAC)])).toEqual([{ kind: 'explain', shipId: SCOUT, reason: 'settings are not valid crew settings: Unrecognized key: "flags"' }]);
  });

  it('counts a trierarch whose options schema it cannot read as not taking the options', () => {
    const unreadable = aTrierarch(MAC, { details: details({ harnesses: [{ harness: 'claude-code', options: { type: 'no-such-type' }, flags: [] }] }) });

    expect(place([aRequest(SCOUT)], [unreadable])).toMatchObject([{ kind: 'explain', shipId: SCOUT }]);
  });

  it('assigns a request with machine labels only to a trierarch whose ship carries every one (#102)', () => {
    const mac = aTrierarch(MAC, { labelValueIds: [MACOS, ARM64], assigned: 1 });
    const linux = aTrierarch(LINUX, { labelValueIds: [LINUX_OS, ARM64], details: details({ caps: { ships: 8, running: 4 } }) });

    expect(place([aRequest(SCOUT, { settings: { machineLabels: [MACOS, ARM64] } })], [linux, mac])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('leaves a request whose machine labels no trierarch carries all of unassigned, with the reason', () => {
    const mac = aTrierarch(MAC, { labelValueIds: [MACOS] });

    expect(place([aRequest(SCOUT, { settings: { machineLabels: [MACOS, ARM64] } })], [mac])).toEqual([{ kind: 'explain', shipId: SCOUT, reason: 'no machine matches its labels' }]);
  });

  it('places a request without machine labels on any machine, labelled or not', () => {
    expect(place([aRequest(SCOUT)], [aTrierarch(MAC, { labelValueIds: [MACOS] })])).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('does not write a reason again that still holds', () => {
    expect(place([aRequest(SCOUT, { settings: { harness: 'codex' }, reason: 'no trierarch offers harness codex' })], [aTrierarch(MAC)])).toEqual([]);
  });
});

describe('checking settings before a request (#245)', () => {
  const settings = (overrides: Record<string, unknown> = {}) => ({ harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' }, ...overrides });

  it('fits when a trierarch offers the harness and workspace, takes the options and has room', () => {
    expect(checkPlacement(settings(), [aTrierarch(MAC)])).toEqual({ kind: 'fits' });
  });

  it('refuses a harness no trierarch offers, naming the field', () => {
    expect(checkPlacement(settings({ harness: 'codex' }), [aTrierarch(MAC)])).toEqual({ kind: 'refused', field: 'harness', reason: 'no trierarch offers harness codex' });
  });

  it('refuses a workspace no trierarch with the harness has, naming the field', () => {
    expect(checkPlacement(settings({ workspace: { kind: 'folder', name: 'website' } }), [aTrierarch(MAC)])).toEqual({
      kind: 'refused',
      field: 'workspace',
      reason: 'no trierarch offering claude-code has folder website',
    });
  });

  it('refuses options no trierarch takes, naming the field', () => {
    expect(checkPlacement(settings({ options: { model: 'haiku' } }), [aTrierarch(MAC)])).toMatchObject({ kind: 'refused', field: 'options' });
  });

  it('refuses settings that are no crew settings, naming the field that breaks the rule', () => {
    expect(checkPlacement(settings({ firstPrompt: '--dangerously-skip-permissions' }), [aTrierarch(MAC)])).toMatchObject({ kind: 'refused', field: 'firstPrompt' });
  });

  it('says there is no room when every trierarch that fits is full: the request would wait', () => {
    expect(checkPlacement(settings(), [aTrierarch(MAC, { assigned: 4 })])).toEqual({ kind: 'noRoom', reason: 'no trierarch with room: all 1 that fit are full' });
  });

  it('says a request whose machine labels no machine carries would wait, as Q8 allows it (#102)', () => {
    expect(checkPlacement(settings({ machineLabels: [LINUX_OS] }), [aTrierarch(MAC, { labelValueIds: [MACOS] })])).toEqual({ kind: 'noRoom', reason: 'no machine matches its labels' });
  });

  it('says there is no room while no trierarch reports yet', () => {
    expect(checkPlacement(settings(), [])).toEqual({ kind: 'noRoom', reason: 'no trierarch reports yet' });
  });
});
