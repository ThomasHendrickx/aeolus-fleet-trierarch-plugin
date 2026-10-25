import type { ShipId, TrierarchReportDetails } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { checkPlacement, place, type PlacementRequest, type PlacementTrierarch } from './placement.js';

const EARLY = new Date('2026-10-01T10:00:00.000Z');
const LATER = new Date('2026-10-02T10:00:00.000Z');
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const LOOKOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1b';
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const LINUX: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2b';
const WINDOWS: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2c';

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
    givenBack: [],
    ...rest,
    settings: { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' }, ...settings },
  };
}

describe('placement (docs/trierarch.md, Assignment)', () => {
  it('assigns a request to a trierarch that offers its harness and workspace, takes its options and has room', () => {
    expect(place([aRequest(SCOUT)], { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('assigns a folder request to a trierarch that offers the folder', () => {
    expect(place([aRequest(SCOUT, { settings: { workspace: { kind: 'folder', name: 'notes' } } })], { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('of several that fit, picks the most room as a percentage of its cap', () => {
    const small = aTrierarch(MAC, { details: details({ caps: { ships: 2, running: 1 } }), assigned: 1 });
    const large = aTrierarch(LINUX, { details: details({ caps: { ships: 8, running: 4 } }), assigned: 2, commissionedAt: LATER });

    expect(place([aRequest(SCOUT)], { trierarchs: [small, large], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: LINUX }]);
  });

  it('of several with the same room, picks the oldest', () => {
    const younger = aTrierarch(LINUX, { commissionedAt: LATER });
    const older = aTrierarch(MAC, { commissionedAt: EARLY });

    expect(place([aRequest(SCOUT)], { trierarchs: [younger, older], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('serves the oldest request first: it takes the last room', () => {
    const newer = aRequest(LOOKOUT, { requestedAt: LATER });
    const older = aRequest(SCOUT, { requestedAt: EARLY });

    expect(place([newer, older], { trierarchs: [aTrierarch(MAC, { assigned: 3 })], enabledModels: [] })).toEqual([
      { kind: 'assign', shipId: SCOUT, trierarchShipId: MAC },
      { kind: 'explain', shipId: LOOKOUT, reason: 'no trierarch with room: all 1 that fit are full' },
    ]);
  });

  it('counts what it assigns in the same pass against the room', () => {
    const first = aRequest(SCOUT, { requestedAt: EARLY });
    const second = aRequest(LOOKOUT, { requestedAt: LATER });
    const mac = aTrierarch(MAC, { details: details({ caps: { ships: 2, running: 1 } }) });
    const linux = aTrierarch(LINUX, { details: details({ caps: { ships: 2, running: 1 } }), commissionedAt: LATER });

    expect(place([first, second], { trierarchs: [mac, linux], enabledModels: [] })).toEqual([
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
    { label: 'none has room', trierarchs: [aTrierarch(MAC, { assigned: 4 }), aTrierarch(LINUX, { assigned: 4 })], settings: {}, reason: 'no trierarch with room: all 2 that fit are full' },
  ])('leaves a request unassigned with the reason when $label', ({ trierarchs, settings, reason }) => {
    expect(place([aRequest(SCOUT, { settings })], { trierarchs, enabledModels: [] })).toEqual([{ kind: 'explain', shipId: SCOUT, reason }]);
  });

  it('assigns a request with an option its harness does not declare, ignoring that option (#366)', () => {
    expect(place([aRequest(SCOUT, { settings: { options: { model: 'opus', effort: 'max' } } })], { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('leaves a request whose settings are not crew settings unassigned with the reason', () => {
    expect(place([aRequest(SCOUT, { settings: { flags: ['--yolo'] } })], { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual([{ kind: 'explain', shipId: SCOUT, reason: 'settings are not valid crew settings: Unrecognized key: "flags"' }]);
  });

  it('counts a trierarch whose options schema it cannot read as not taking the options', () => {
    const unreadable = aTrierarch(MAC, { details: details({ harnesses: [{ harness: 'claude-code', options: { type: 'no-such-type' }, flags: [] }] }) });

    expect(place([aRequest(SCOUT)], { trierarchs: [unreadable], enabledModels: [] })).toMatchObject([{ kind: 'explain', shipId: SCOUT }]);
  });

  it('assigns a request with machine labels only to a trierarch whose ship carries every one (#102)', () => {
    const mac = aTrierarch(MAC, { labelValueIds: [MACOS, ARM64], assigned: 1 });
    const linux = aTrierarch(LINUX, { labelValueIds: [LINUX_OS, ARM64], details: details({ caps: { ships: 8, running: 4 } }) });

    expect(place([aRequest(SCOUT, { settings: { machineLabels: [MACOS, ARM64] } })], { trierarchs: [linux, mac], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('leaves a request whose machine labels no trierarch carries all of unassigned, with the reason', () => {
    const mac = aTrierarch(MAC, { labelValueIds: [MACOS] });

    expect(place([aRequest(SCOUT, { settings: { machineLabels: [MACOS, ARM64] } })], { trierarchs: [mac], enabledModels: [] })).toEqual([{ kind: 'explain', shipId: SCOUT, reason: 'no machine matches its labels' }]);
  });

  it('places a request without machine labels on any machine, labelled or not', () => {
    expect(place([aRequest(SCOUT)], { trierarchs: [aTrierarch(MAC, { labelValueIds: [MACOS] })], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('assigns a request without a harness to a trierarch whose default harness, the first it reports, takes its options (#343)', () => {
    const codexFirst = details({ harnesses: [{ harness: 'codex', options: { type: 'object', properties: { model: { enum: ['gpt-6'] } }, additionalProperties: false }, flags: [] }, ...details().harnesses] });
    const request = aRequest(SCOUT);
    const withoutHarness = { ...request, settings: { workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' } } };

    expect(place([withoutHarness], { trierarchs: [aTrierarch(MAC, { details: codexFirst }), aTrierarch(LINUX, { commissionedAt: LATER })], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: LINUX }]);
  });

  it('leaves out every trierarch that gave the request back, placing it on another that fits (#382)', () => {
    const request = aRequest(SCOUT, { givenBack: [{ trierarchShipId: MAC, reason: 'mac-studio: claude-code 2.1.293 refused opus' }] });

    expect(place([request], { trierarchs: [aTrierarch(MAC), aTrierarch(LINUX, { commissionedAt: LATER })], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: LINUX }]);
  });

  it('leaves a request every trierarch that fits gave back unassigned, with the last reason it was given back for (#382)', () => {
    const request = aRequest(SCOUT, {
      givenBack: [
        { trierarchShipId: MAC, reason: 'mac-studio: claude-code 2.1.293 refused opus' },
        { trierarchShipId: LINUX, reason: 'linux-box: nothing on screen within a minute' },
      ],
    });

    expect(place([request], { trierarchs: [aTrierarch(MAC), aTrierarch(LINUX)], enabledModels: [] })).toEqual([
      { kind: 'explain', shipId: SCOUT, reason: 'given back by every trierarch that fits; last: linux-box: nothing on screen within a minute' },
    ]);
  });

  it('keeps a reason for a request given back within the 200 characters a reason may hold (#382)', () => {
    const request = aRequest(SCOUT, { givenBack: [{ trierarchShipId: MAC, reason: 'x'.repeat(200) }] });

    const [placement] = place([request], { trierarchs: [aTrierarch(MAC)], enabledModels: [] });

    expect(placement?.kind === 'explain' ? placement.reason.length : 0).toBe(200);
  });

  it('does not write a reason again that still holds', () => {
    expect(place([aRequest(SCOUT, { settings: { harness: 'codex' }, reason: 'no trierarch offers harness codex' })], { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual([]);
  });
});

describe("placement under the fleet's enabled models (model governance, M3)", () => {
  const OPUS = 'claude-opus-5-5';
  const SONNET = 'claude-sonnet-5-5';

  /** Claude Code offering both exact ids, with `defaultModel` as its default when given. */
  function offering(defaultModel?: string): TrierarchReportDetails {
    const model = { enum: [OPUS, SONNET], ...(defaultModel === undefined ? {} : { default: defaultModel }) };
    return details({ harnesses: [{ harness: 'claude-code', options: { type: 'object', properties: { model }, additionalProperties: false }, flags: [] }] });
  }

  const naming = (model: string) => aRequest(SCOUT, { settings: { options: { model } } });
  const namingNone = () => aRequest(SCOUT, { settings: { options: {} } });

  it('places as today when the fleet enabled no model: an empty set is no rule', () => {
    expect(place([naming(OPUS)], { trierarchs: [aTrierarch(MAC, { details: offering(OPUS) })], enabledModels: [] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('leaves a request naming a model the fleet did not enable unassigned, with the reason model disabled', () => {
    expect(place([naming(OPUS)], { trierarchs: [aTrierarch(MAC, { details: offering(OPUS) })], enabledModels: [SONNET] })).toEqual([
      { kind: 'explain', shipId: SCOUT, reason: 'model disabled: claude-opus-5-5' },
    ]);
  });

  it('checks a named model first, before any trierarch: model disabled even while no trierarch reports', () => {
    expect(place([naming(OPUS)], { trierarchs: [], enabledModels: [SONNET] })).toEqual([{ kind: 'explain', shipId: SCOUT, reason: 'model disabled: claude-opus-5-5' }]);
  });

  it('keeps the model disabled reason for a long model within the 200 characters a reason may hold', () => {
    const [placement] = place([naming('x'.repeat(300))], { trierarchs: [aTrierarch(MAC)], enabledModels: [SONNET] });

    expect(placement?.kind === 'explain' ? placement.reason.length : 0).toBe(200);
  });

  it('places a request naming an enabled model as today', () => {
    expect(place([naming(SONNET)], { trierarchs: [aTrierarch(MAC, { details: offering(OPUS) })], enabledModels: [SONNET] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it('places a request naming no model only on a trierarch whose default for the harness is enabled', () => {
    const roomierWithDisabledDefault = aTrierarch(LINUX, { details: { ...offering(SONNET), caps: { ships: 8, running: 4 } } });
    const enabledDefault = aTrierarch(MAC, { details: offering(OPUS), assigned: 2 });

    expect(place([namingNone()], { trierarchs: [roomierWithDisabledDefault, enabledDefault], enabledModels: [OPUS] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: MAC }]);
  });

  it.each([
    { label: 'its default is not enabled', trierarch: aTrierarch(MAC, { details: offering(SONNET) }) },
    { label: 'its harness reports no default model', trierarch: aTrierarch(MAC, { details: offering() }) },
    { label: 'its harness has no model option', trierarch: aTrierarch(MAC, { details: details({ harnesses: [{ harness: 'claude-code', options: {}, flags: [] }] }) }) },
  ])('leaves a request naming no model unassigned when $label, with the reason', ({ trierarch }) => {
    expect(place([namingNone()], { trierarchs: [trierarch], enabledModels: [OPUS] })).toEqual([
      { kind: 'explain', shipId: SCOUT, reason: 'model disabled: no enabled default model for claude-code' },
    ]);
  });

  it('names its default harness in the reason for a request naming neither a model nor a harness', () => {
    const request = { ...namingNone(), settings: { workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} } };

    expect(place([request], { trierarchs: [aTrierarch(MAC, { details: offering(SONNET) })], enabledModels: [OPUS] })).toEqual([
      { kind: 'explain', shipId: SCOUT, reason: 'model disabled: no enabled default model for its default harness' },
    ]);
  });

  it('places a request given back under the rule: on a trierarch with an enabled default that did not give it back', () => {
    const request = { ...namingNone(), givenBack: [{ trierarchShipId: MAC, reason: 'mac-studio: nothing on screen within a minute' }] };
    const gaveItBack = aTrierarch(MAC, { details: offering(OPUS) });
    const disabledDefault = aTrierarch(LINUX, { details: offering(SONNET) });
    const enabledDefault = aTrierarch(WINDOWS, { details: offering(OPUS), commissionedAt: LATER });

    expect(place([request], { trierarchs: [gaveItBack, disabledDefault, enabledDefault], enabledModels: [OPUS] })).toEqual([{ kind: 'assign', shipId: SCOUT, trierarchShipId: WINDOWS }]);
  });

  it('refuses before a request a named model the fleet did not enable, with the field options and the same reason (M4)', () => {
    const settings = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: OPUS } };

    expect(checkPlacement(settings, { trierarchs: [aTrierarch(MAC, { details: offering(OPUS) })], enabledModels: [SONNET] })).toEqual({
      kind: 'refused',
      field: 'options',
      reason: 'model disabled: claude-opus-5-5',
    });
  });

  it('refuses before a request settings naming no model where no trierarch has an enabled default, with the field options and the same reason (M4)', () => {
    const settings = { harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} };

    expect(checkPlacement(settings, { trierarchs: [aTrierarch(MAC, { details: offering(SONNET) })], enabledModels: [OPUS] })).toEqual({
      kind: 'refused',
      field: 'options',
      reason: 'model disabled: no enabled default model for claude-code',
    });
  });
});

describe('checking settings before a request (#245)', () => {
  const settings = (overrides: Record<string, unknown> = {}) => ({ harness: 'claude-code', workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'opus' }, ...overrides });

  it('fits when a trierarch offers the harness and workspace, takes the options and has room', () => {
    expect(checkPlacement(settings(), { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual({ kind: 'fits' });
  });

  it('refuses a harness no trierarch offers, naming the field', () => {
    expect(checkPlacement(settings({ harness: 'codex' }), { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual({ kind: 'refused', field: 'harness', reason: 'no trierarch offers harness codex' });
  });

  it('refuses a workspace no trierarch with the harness has, naming the field', () => {
    expect(checkPlacement(settings({ workspace: { kind: 'folder', name: 'website' } }), { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual({
      kind: 'refused',
      field: 'workspace',
      reason: 'no trierarch offering claude-code has folder website',
    });
  });

  it('fits settings with an option no harness declares: it is ignored (#366)', () => {
    expect(checkPlacement(settings({ options: { model: 'opus', effort: 'max' } }), { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual({ kind: 'fits' });
  });

  it('refuses options no trierarch takes, naming the field', () => {
    expect(checkPlacement(settings({ options: { model: 'haiku' } }), { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toMatchObject({ kind: 'refused', field: 'options' });
  });

  it('refuses settings that are no crew settings, naming the field that breaks the rule', () => {
    expect(checkPlacement(settings({ firstPrompt: '--dangerously-skip-permissions' }), { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toMatchObject({ kind: 'refused', field: 'firstPrompt' });
  });

  it('says there is no room when every trierarch that fits is full: the request would wait', () => {
    expect(checkPlacement(settings(), { trierarchs: [aTrierarch(MAC, { assigned: 4 })], enabledModels: [] })).toEqual({ kind: 'noRoom', reason: 'no trierarch with room: all 1 that fit are full' });
  });

  it('says a request whose machine labels no machine carries would wait, as Q8 allows it (#102)', () => {
    expect(checkPlacement(settings({ machineLabels: [LINUX_OS] }), { trierarchs: [aTrierarch(MAC, { labelValueIds: [MACOS] })], enabledModels: [] })).toEqual({ kind: 'noRoom', reason: 'no machine matches its labels' });
  });

  it('checks the options of settings without a harness against each trierarch\'s default harness, naming the field (#343)', () => {
    const withoutHarness = { workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: { model: 'haiku' } };

    expect(checkPlacement(withoutHarness, { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual({
      kind: 'refused',
      field: 'options',
      reason: 'no trierarch takes these options for its default harness: options.model: Invalid option: expected one of "opus"|"sonnet"',
    });
    expect(checkPlacement({ ...withoutHarness, options: { model: 'sonnet' } }, { trierarchs: [aTrierarch(MAC)], enabledModels: [] })).toEqual({ kind: 'fits' });
  });

  it('refuses a request without a harness where no trierarch offers any harness, naming the field (#343)', () => {
    const withoutHarness = { workspace: { kind: 'worktree', repository: 'aeolus-fleet' }, options: {} };

    expect(checkPlacement(withoutHarness, { trierarchs: [aTrierarch(MAC, { details: details({ harnesses: [] }) })], enabledModels: [] })).toEqual({ kind: 'refused', field: 'harness', reason: 'no trierarch offers a harness' });
  });

  it('says there is no room while no trierarch reports yet', () => {
    expect(checkPlacement(settings(), { trierarchs: [], enabledModels: [] })).toEqual({ kind: 'noRoom', reason: 'no trierarch reports yet' });
  });
});
