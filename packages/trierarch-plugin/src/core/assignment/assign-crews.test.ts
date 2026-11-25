import { trierarchGuardRulesMessageSchema, type ShipId, type TrierarchReportDetails } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_ASSIGNEE, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { memoryMcpConfigurations } from '../../../test/support/memory-mcp-configurations.js';
import { memoryMcpDeliveries } from '../../../test/support/memory-mcp-deliveries.js';
import { memoryEnabledModels } from '../../../test/support/memory-models.js';
import type { GuardRuleDefinition } from '../guard/ports.js';
import type { GuardAssignments, ReadAssignmentGuard, ResolvedGuardSet } from './ports.js';
import { createAssignCrews } from './assign-crews.js';

const AT = new Date('2026-10-06T22:00:00.000Z');
const SILENT_AFTER_MS = 5 * 60 * 1000;
const NOW = new Date('2026-10-06T23:00:00.000Z');
const RECENTLY = new Date(NOW.getTime() - 1000);
const LONG_AGO = new Date(NOW.getTime() - SILENT_AFTER_MS - 1);
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const LINUX: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2b';
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const LOOKOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3b';

const DETAILS: TrierarchReportDetails = {
  harnesses: [{ harness: 'claude-code', options: {}, flags: [] }],
  workspaces: { repositories: ['aeolus-fleet'], folders: [] },
  caps: { ships: 2, running: 1 },
  kept: [],
  orphans: [],
  version: '0.19.0',
};
const SETTINGS = { harness: 'claude-code', workspace: { kind: 'repositories', main: { repository: 'aeolus-fleet' }, subRepositories: [] }, options: {} };

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let models: ReturnType<typeof memoryEnabledModels>;
let configurations: ReturnType<typeof memoryMcpConfigurations>;
let deliveries: ReturnType<typeof memoryMcpDeliveries>;
const BASE: GuardRuleDefinition = { name: 'base', repository: 'fleet/rules', commit: 'a'.repeat(40), file: 'base.yaml', rules: { git: { deny: ['push'] } } };
const CHOSEN: GuardRuleDefinition = { name: 'chosen', repository: 'fleet/rules', commit: 'b'.repeat(40), file: 'chosen.yaml', rules: { tools: { deny: ['web'] } } };
let floor: string[];
let isReadFailed: boolean;
let definitions: GuardRuleDefinition[];
let pinned: Map<string, readonly ResolvedGuardSet[]>;
let attempts: Map<string, string>;

beforeEach(async () => {
  isReadFailed = false;
  floor = [];
  definitions = [];
  pinned = new Map();
  attempts = new Map();
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  models = memoryEnabledModels();
  configurations = memoryMcpConfigurations();
  deliveries = memoryMcpDeliveries();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

/** A crewed trierarch that reported the details, last seen as given. */
function aTrierarch(shipId: ShipId, at: { lastSeenAt?: Date; details?: TrierarchReportDetails } = {}): void {
  fleet.state.ships.push({ shipId, name: `machine-${shipId.slice(-2)}`, type: 'trierarch', status: 'crewed', lastSeenAt: at.lastSeenAt ?? RECENTLY, model: null, crewRequest: null, labels: [] });
  fleet.state.reports.set(shipId, { state: 'idle', note: '0 of 2 running', reportedAt: RECENTLY, details: at.details ?? DETAILS });
}

/** A ship with a crew request, unassigned unless it says otherwise. */
function aRequest(shipId: ShipId, at: { status?: 'awaitingCrew' | 'crewed'; assignedTo?: ShipId; requestedAt?: Date; settings?: unknown; settingsVersion?: number } = {}): void {
  fleet.state.ships.push({
    shipId,
    name: `ship-${shipId.slice(-2)}`,
    type: 'implementer',
    status: at.status ?? 'awaitingCrew',
    lastSeenAt: null,
    model: null,
    crewRequest: { settingsVersion: at.settingsVersion ?? 1, requestedAt: at.requestedAt ?? AT, assignedTo: at.assignedTo ?? null, reason: null, startedAt: null, givenBack: [], requestedBy: null },
    labels: [],
  });
  fleet.state.settings.set(shipId, at.settings ?? SETTINGS);
}

const assignedTo = (shipId: ShipId) => fleet.state.ships.find((ship) => ship.shipId === shipId)?.crewRequest?.assignedTo;

const readGuard: ReadAssignmentGuard = () => Promise.resolve({ floor, definitions, isReadFailed });
const guardAssignments: GuardAssignments = {
  readPinnedFor: (fleetId, requests) => {
    const results = new Map<ShipId, readonly ResolvedGuardSet[]>();
    for (const { shipId, settingsVersion } of requests) {
      const stored = pinned.get(`${fleetId}/${shipId}/${String(settingsVersion)}`);
      if (stored !== undefined) { results.set(shipId, stored); }
    }
    return Promise.resolve(results);
  },
  pin: (fleetId, { shipId, settingsVersion, sets }) => {
    const key = `${fleetId}/${shipId}/${String(settingsVersion)}`;
    const stored = pinned.get(key) ?? sets;
    pinned.set(key, stored);
    return Promise.resolve(stored);
  },
  attempt: (fleetId, { shipId, settingsVersion, trierarchShipId, idempotencyKey }) => {
    const key = `${fleetId}/${shipId}/${String(settingsVersion)}/${trierarchShipId}`;
    const stored = attempts.get(key) ?? idempotencyKey;
    attempts.set(key, stored);
    return Promise.resolve(stored);
  },
};

const pass = () => createAssignCrews({ readGuard, guardAssignments, keys: { next: () => String(attempts.size + 1) }, door: fleet.door, connections, models, configurations, deliveries, clock: { now: () => NOW }, silentAfterMs: SILENT_AFTER_MS })(FLEET_ID);

const MAC_KEY = `${'mac'.padEnd(43, 'A')}=`;
/** What a trierarch offering company-graph on Claude Code reports, with its sealing key. */
const GRAPH_DETAILS: TrierarchReportDetails = { ...DETAILS, harnesses: [{ harness: 'claude-code', options: {}, flags: [], mcpServers: ['company-graph'] }], sealingKey: { scheme: 'nacl-sealed-box', publicKey: MAC_KEY } };

/** The fleet's MCP configuration moved on to version 1, and what MAC confirmed it applied. */
async function confirmed(applied: { version: number; publicKey: string } | null): Promise<void> {
  await configurations.replace(FLEET_ID, { expectedVersion: 0, configuration: { version: 1, servers: [], secrets: [] }, event: { type: 'McpConfigurationReplaced', fleetId: FLEET_ID, version: 1, actor: { kind: 'operator', accountId: null }, changed: { servers: [], secrets: [] }, at: AT } });
  if (applied !== null) {
    await deliveries.recordApplied(FLEET_ID, { trierarchShipId: MAC, applied });
  }
}

describe('guard rules delivery', () => {
  it('sends an empty rules message before claiming an assignment without rules', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);
    const claim = fleet.door.assignCrew.bind(fleet.door);
    fleet.door.assignCrew = (token, input) => {
      expect(fleet.state.sent).toEqual([expect.objectContaining({
        shipId: MAC,
        contentType: 'application/vnd.aeolus.trierarch.guard-rules+json',
        payload: JSON.stringify({ fleetId: FLEET_ID, pluginShipId: SHIP_ID, shipId: SCOUT, settingsVersion: 1, sets: [] }),
      })]);
      return claim(token, input);
    };

    await pass();

    expect(assignedTo(SCOUT)).toBe(MAC);
  });

  it('sends the resolved floor and selected set to an eligible guarded harness', async () => {
    floor = ['base'];
    definitions = [BASE, CHOSEN];
    aTrierarch(MAC);
    aTrierarch(LINUX, { details: { ...DETAILS, guardedHarnesses: ['claude-code'] } });
    aRequest(SCOUT, { settings: { ...SETTINGS, ruleSet: 'chosen' } });

    await pass();

    expect(assignedTo(SCOUT)).toBe(LINUX);
    const [message] = fleet.state.sent;
    expect(message?.shipId).toBe(LINUX);
    expect(trierarchGuardRulesMessageSchema.parse(JSON.parse(message?.payload ?? '{}'))).toEqual({
      fleetId: FLEET_ID,
      pluginShipId: SHIP_ID,
      shipId: SCOUT,
      settingsVersion: 1,
      sets: [{ ...BASE, floor: true }, { ...CHOSEN, floor: false }],
    });
  });

  it.each([
    { label: 'unknown selected set', names: [], ruleSet: 'missing', reason: 'rule set unknown: missing' },
    { label: 'unavailable floor', names: ['missing'], ruleSet: undefined, reason: 'floor unavailable: missing' },
    { label: 'unguarded harness', names: ['base'], ruleSet: undefined, reason: 'no guarded harness: claude-code' },
  ])('explains an $label and sends no rules', async ({ names, ruleSet, reason }) => {
    floor = names;
    definitions = [BASE];
    aTrierarch(MAC);
    aRequest(SCOUT, { settings: { ...SETTINGS, ruleSet } });

    await pass();

    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason }]);
    expect(fleet.state.sent).toEqual([]);
  });

  it.each([
    { defaults: ['codex'], reason: 'no guarded harness: codex' },
    { defaults: ['codex', 'claude-code', 'codex'], reason: 'no guarded harness: claude-code, codex' },
  ])('names the distinct eligible default harnesses $defaults when none is guarded', async ({ defaults, reason }) => {
    floor = ['base'];
    definitions = [BASE];
    [MAC, LINUX, LOOKOUT].forEach((id, index) => {
      const harness = defaults[index];
      if (harness !== undefined) {
        aTrierarch(id, { details: { ...DETAILS, harnesses: [{ harness, flags: [], options: {} }] } });
      }
    });
    aRequest(SCOUT, { settings: { ...SETTINGS, harness: undefined } });

    await pass();

    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason }]);
  });

  it.each([65536, 65537])('checks the receiver limit at %i bytes of resolved sets', async (bytes) => {
    const makeSet = (argument: string) => ({ ...BASE, rules: { ...BASE.rules, commands: { deny: [{ command: 'npm', args: [argument] }] } } });
    const empty = Buffer.byteLength(JSON.stringify([{ ...makeSet(''), floor: true }]));
    const padding = bytes - empty;
    floor = ['base'];
    definitions = [makeSet('é'.repeat(Math.floor(padding / 2)) + 'a'.repeat(padding % 2))];
    aTrierarch(MAC, { details: { ...DETAILS, guardedHarnesses: ['claude-code'] } });
    aRequest(SCOUT);

    await pass();

    expect(assignedTo(SCOUT)).toBe(bytes === 65536 ? MAC : null);
    expect(fleet.state.explained).toEqual(bytes === 65536 ? [] : [{ shipId: SCOUT, reason: 'rule sets too large' }]);
  });

  it('resolves an existing request from the last valid read while the repository is unavailable', async () => {
    floor = ['base'];
    definitions = [BASE];
    isReadFailed = true;
    aTrierarch(MAC, { details: { ...DETAILS, guardedHarnesses: ['claude-code'] } });
    aRequest(SCOUT);

    await pass();

    const [message] = fleet.state.sent;
    expect(trierarchGuardRulesMessageSchema.parse(JSON.parse(message?.payload ?? '{}')).sets).toEqual([{ ...BASE, floor: true }]);
  });

  it('reuses the pinned rule sets after a give-back and resolves again for new settings', async () => {
    floor = ['base'];
    definitions = [BASE];
    const details = { ...DETAILS, guardedHarnesses: ['claude-code'] };
    aTrierarch(MAC, { details });
    aTrierarch(LINUX, { details });
    aRequest(SCOUT);
    await pass();
    const ship = fleet.state.ships.find(({ shipId }) => shipId === SCOUT);
    if (ship?.crewRequest == null) { return expect.unreachable('The crew request must exist'); }
    ship.crewRequest = { ...ship.crewRequest, assignedTo: null, givenBack: [{ trierarchShipId: MAC, reason: 'gave it back' }] };
    definitions = [{ ...BASE, commit: 'c'.repeat(40) }];

    await pass();

    expect(assignedTo(SCOUT)).toBe(LINUX);
    expect(fleet.state.sent[1]?.payload).toContain('a'.repeat(40));
    ship.crewRequest = { ...ship.crewRequest, assignedTo: null, givenBack: [], settingsVersion: 2 };

    await pass();

    expect(fleet.state.sent[2]?.payload).toContain('c'.repeat(40));
  });

  it('retries an accepted send under the same key if its answer was lost', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);
    const send = fleet.door.send.bind(fleet.door);
    fleet.door.send = async (token, message) => {
      await send(token, message);
      return { isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } };
    };
    await pass();
    expect(assignedTo(SCOUT)).toBeNull();
    fleet.door.send = send;

    await pass();

    expect(fleet.state.sent).toHaveLength(1);
    expect(assignedTo(SCOUT)).toBe(MAC);
  });

  it('leaves the request unassigned when the fleet does not accept the rules message', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);
    fleet.state.isAnsweringSends = false;

    await pass();

    expect(assignedTo(SCOUT)).toBeNull();
  });
});

describe("a pass and the fleet's MCP configuration (the fleet crew MCP design, section 5)", () => {
  const NAMING_GRAPH = { ...SETTINGS, mcpServers: ['company-graph'] };

  it("places a request naming a server on a trierarch that confirmed the fleet's current version for its key", async () => {
    aTrierarch(MAC, { details: GRAPH_DETAILS });
    aRequest(SCOUT, { settings: NAMING_GRAPH });
    await confirmed({ version: 1, publicKey: MAC_KEY });

    await pass();

    expect(assignedTo(SCOUT)).toBe(MAC);
  });

  it.each([
    { label: 'confirmed nothing', applied: null },
    { label: 'confirmed an older version', applied: { version: 0, publicKey: MAC_KEY } },
    { label: 'confirmed the version for another key', applied: { version: 1, publicKey: `${'old'.padEnd(43, 'A')}=` } },
  ])('leaves a request naming a server waiting on a trierarch that $label, with the reason', async ({ applied }) => {
    aTrierarch(MAC, { details: GRAPH_DETAILS });
    aRequest(SCOUT, { settings: NAMING_GRAPH });
    await confirmed(applied);

    await pass();

    expect(assignedTo(SCOUT)).toBeNull();
    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason: 'no trierarch offering claude-code offers MCP server company-graph' }]);
  });

  it('places a request naming no server on a trierarch that confirmed nothing', async () => {
    aTrierarch(MAC, { details: GRAPH_DETAILS });
    aRequest(SCOUT);
    await confirmed(null);

    await pass();

    expect(assignedTo(SCOUT)).toBe(MAC);
  });
});

describe("a pass of the trierarch plugin's assignment", () => {
  it("places by the fleet's enabled models as they are at the pass: a request naming none waits on model not available (model governance, M3, M5)", async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);
    await models.enable(FLEET_ID, 'claude-opus-5-5');

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 1, lost: 0 } });
    expect(fleet.state.ships.find((ship) => ship.shipId === SCOUT)?.crewRequest?.reason).toBe('model not available: no enabled default model for claude-code');
  });

  it('claims each unassigned request for the trierarch placement picks', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 1, explained: 0, lost: 0 } });
    expect(assignedTo(SCOUT)).toBe(MAC);
  });

  it('places a request given back on another trierarch, never on the one that gave it back (#382)', async () => {
    aTrierarch(MAC);
    aTrierarch(LINUX);
    aRequest(SCOUT);
    const scout = fleet.state.ships.find((ship) => ship.shipId === SCOUT);
    if (scout?.crewRequest) {
      scout.crewRequest.givenBack = [{ trierarchShipId: MAC, reason: 'machine-2a: claude-code refused the model' }];
    }

    await pass();

    expect(assignedTo(SCOUT)).toBe(LINUX);
  });

  it('never assigns a crewed ship: crewing it by hand fulfils its request', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT, { status: 'crewed' });

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 0, lost: 0 } });
    expect(assignedTo(SCOUT)).toBeNull();
  });

  it('counts the requests assigned to a trierarch already against its room', async () => {
    aTrierarch(MAC);
    aRequest(LOOKOUT, { assignedTo: MAC });
    aRequest(SCOUT, { assignedTo: MAC });
    aRequest('shp_01m3tbfspe96yf1rnr4ank9h3c');

    await pass();

    expect(fleet.state.explained).toEqual([{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9h3c', reason: 'no trierarch with room: all 1 that fit are full' }]);
  });

  it('writes the reason on a request none fits, and leaves it unassigned', async () => {
    aRequest(SCOUT);

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 1, lost: 0 } });
    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason: 'no trierarch reports yet' }]);
    expect(assignedTo(SCOUT)).toBeNull();
  });

  it('takes a lost claim as no error: the request is read again on the next pass', async () => {
    aTrierarch(MAC);
    aRequest(SCOUT);
    fleet.state.isLosingClaims = true;

    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 0, lost: 1 } });
    fleet.state.isLosingClaims = false;
    await expect(pass()).resolves.toEqual({ isOk: true, value: { assigned: 0, explained: 0, lost: 0 } });
    expect(assignedTo(SCOUT)).toBe(OTHER_ASSIGNEE);
  });

  it('gives a silent trierarch no new request, and leaves the requests it holds assigned to it', async () => {
    aTrierarch(MAC, { lastSeenAt: LONG_AGO });
    aTrierarch(LINUX);
    aRequest(LOOKOUT, { assignedTo: MAC });
    aRequest(SCOUT);

    await pass();

    expect(assignedTo(SCOUT)).toBe(LINUX);
    expect(assignedTo(LOOKOUT)).toBe(MAC);
  });

  it('considers no trierarch that has not reported details yet', async () => {
    fleet.state.ships.push({ shipId: MAC, name: 'mac-studio', type: 'trierarch', status: 'awaitingCrew', lastSeenAt: null, model: null, crewRequest: null, labels: [] });
    aRequest(SCOUT);

    await pass();

    expect(fleet.state.explained).toEqual([{ shipId: SCOUT, reason: 'no trierarch reports yet' }]);
  });

  it('places a request on a trierarch that reports a sealing key', async () => {
    const sealingKey = { scheme: 'nacl-sealed-box' as const, publicKey: Buffer.alloc(32, 7).toString('base64') };
    aTrierarch(MAC, { details: { ...DETAILS, sealingKey } });
    aRequest(SCOUT);

    await pass();

    expect(assignedTo(SCOUT)).toBe(MAC);
  });

  it('serves the oldest request first', async () => {
    aTrierarch(MAC, { details: { ...DETAILS, caps: { ships: 1, running: 1 } } });
    aRequest(LOOKOUT, { requestedAt: new Date(AT.getTime() + 1000) });
    aRequest(SCOUT, { requestedAt: AT });

    await pass();

    expect(assignedTo(SCOUT)).toBe(MAC);
    expect(assignedTo(LOOKOUT)).toBeNull();
  });

  it('is refused while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(pass()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('is refused while the fleet does not answer', async () => {
    fleet.state.isAnswering = false;

    await expect(pass()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
