import { ARGO_HEADLINE_MAX_LENGTH, CREW_REQUEST_REASON_CONTENT_TYPE, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakePluginFleet, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createTellCrewRequestReasons } from './tell-crew-request-reasons.js';

const AT = new Date('2026-11-08T08:00:00.000Z');
const SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h3a';
const ORCHESTRATOR: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h4a';
const MAC: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h2a';
const LOOKOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h5a';

const MODEL_REASON = 'model not available: gpt-5.6-terra';
const GIVEN_BACK_REASON = 'given back by every trierarch that fits; last: the harness would not start';

let fleet: ReturnType<typeof fakePluginFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  fleet = fakePluginFleet();
  connections = memoryConnectionStore();
  fleet.state.liveTokens.add('aeolus_ct_v1_plugin');
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'trierarch-plugin', crewToken: 'aeolus_ct_v1_plugin', crewedAt: AT });
});

/** The ship that made the requests, as the fleet lists it: crewed unless a test retires it. */
function aRequester(at: { status?: 'crewed' | 'retired' } = {}): void {
  fleet.state.ships.push({ shipId: ORCHESTRATOR, name: 'orchestrator', type: 'orchestrator', status: at.status ?? 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] });
}

/** A ship awaiting crew whose unassigned request carries the reason placement wrote, made by the orchestrator unless a test says otherwise. */
function aWaitingRequest(at: { shipId?: ShipId; name?: string; reason?: string | null; settingsVersion?: number; requestedBy?: { shipId: ShipId; name: string } | null; assignedTo?: ShipId | null } = {}): void {
  fleet.state.ships.push({
    shipId: at.shipId ?? SCOUT,
    name: at.name ?? 'scout',
    type: 'implementer',
    status: 'awaitingCrew',
    lastSeenAt: null,
    model: null,
    crewRequest: {
      settingsVersion: at.settingsVersion ?? 1,
      requestedAt: AT,
      assignedTo: at.assignedTo ?? null,
      reason: at.reason === undefined ? MODEL_REASON : at.reason,
      startedAt: null,
      givenBack: [],
      requestedBy: at.requestedBy === undefined ? { shipId: ORCHESTRATOR, name: 'orchestrator' } : at.requestedBy,
    },
    labels: [],
  });
}

/** The ship awaiting crew, its request rewritten as a new pass would leave it. */
function rewritten(at: { reason?: string; settingsVersion?: number }): void {
  fleet.state.ships.splice(
    fleet.state.ships.findIndex((ship) => ship.shipId === SCOUT),
    1,
  );
  aWaitingRequest(at);
}

const tellWith = (told: Set<string>) => createTellCrewRequestReasons({ door: fleet.door, connections, told });
const tell = () => tellWith(new Set())(FLEET_ID);

describe('telling the requester why its crew request waits', () => {
  it('tells the requester a model that is not available', async () => {
    aRequester();
    aWaitingRequest();

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 1, untold: 0, refused: 0 } });
    expect(fleet.state.sent).toEqual([
      {
        shipId: ORCHESTRATOR,
        contentType: CREW_REQUEST_REASON_CONTENT_TYPE,
        payload: JSON.stringify({ shipId: SCOUT, shipName: 'scout', settingsVersion: 1, reason: MODEL_REASON }),
        idempotencyKey: `trierarch-plugin:crew-request-reason:${SCOUT}:1:model`,
      },
    ]);
  });

  it('tells the requester a request every trierarch that fits gave back', async () => {
    aRequester();
    aWaitingRequest({ reason: GIVEN_BACK_REASON });

    await tell();

    expect(fleet.state.sent).toEqual([
      {
        shipId: ORCHESTRATOR,
        contentType: CREW_REQUEST_REASON_CONTENT_TYPE,
        payload: JSON.stringify({ shipId: SCOUT, shipName: 'scout', settingsVersion: 1, reason: GIVEN_BACK_REASON }),
        idempotencyKey: `trierarch-plugin:crew-request-reason:${SCOUT}:1:givenBack`,
      },
    ]);
  });

  it('tells the requester a model that is not available and then a give-back of the same settings version, once each', async () => {
    aRequester();
    aWaitingRequest();
    await tell();
    rewritten({ reason: GIVEN_BACK_REASON });

    await tell();

    expect(fleet.state.sent.map((message) => message.idempotencyKey)).toEqual([`trierarch-plugin:crew-request-reason:${SCOUT}:1:model`, `trierarch-plugin:crew-request-reason:${SCOUT}:1:givenBack`]);
  });

  it('tells the requester once across passes', async () => {
    aRequester();
    aWaitingRequest();
    const told = new Set<string>();

    await tellWith(told)(FLEET_ID);
    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 0, untold: 0, refused: 0 } });

    expect(fleet.state.sent).toHaveLength(1);
  });

  it('tells the requester once across restarts of the trierarch plugin', async () => {
    aRequester();
    aWaitingRequest();

    await tell();
    await tell();

    expect(fleet.state.sent).toHaveLength(1);
  });

  it('tells nothing again for a rewritten reason of the same kind, across a restart', async () => {
    aRequester();
    aWaitingRequest({ reason: GIVEN_BACK_REASON });
    await tell();
    rewritten({ reason: 'given back by every trierarch that fits; last: the workspace is missing' });

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 0, untold: 0, refused: 0 } });

    expect(fleet.state.sent).toHaveLength(1);
  });

  it('tells the requester again for a new settings version', async () => {
    aRequester();
    aWaitingRequest();
    await tell();
    rewritten({ settingsVersion: 2 });

    await tell();

    expect(fleet.state.sent.map((message) => message.idempotencyKey)).toEqual([`trierarch-plugin:crew-request-reason:${SCOUT}:1:model`, `trierarch-plugin:crew-request-reason:${SCOUT}:2:model`]);
  });

  it.each([
    ['no room', 'no trierarch with room: all 2 that fit are full'],
    ['a missing workspace', 'no trierarch offering harness claude-code has repository aeolus-fleet'],
    ['no reports', 'no trierarch reports yet'],
  ])('tells nothing for %s', async (_, reason) => {
    aRequester();
    aWaitingRequest({ reason });

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 0, untold: 0, refused: 0 } });
    expect(fleet.state.sent).toEqual([]);
    expect(fleet.state.told).toEqual([]);
  });

  it('tells nothing for a request with no reason', async () => {
    aRequester();
    aWaitingRequest({ reason: null });

    await tell();

    expect(fleet.state.sent).toEqual([]);
  });

  it('tells nothing for a request a trierarch claimed', async () => {
    aRequester();
    aWaitingRequest({ assignedTo: MAC });

    await tell();

    expect(fleet.state.sent).toEqual([]);
  });

  it('tells argo, naming the ship, the requester and the reason, when the requester is retired', async () => {
    aRequester({ status: 'retired' });
    aWaitingRequest();

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 1, untold: 0, refused: 0 } });
    expect(fleet.state.sent).toEqual([]);
    expect(fleet.state.told).toEqual([
      {
        text: `Ship scout waits: ${MODEL_REASON}\n\nShip scout's crew request (settings version 1) waits: ${MODEL_REASON}. Ship orchestrator made it and is retired, so the trierarch plugin tells argo.`,
        idempotencyKey: `trierarch-plugin:crew-request-reason:${SCOUT}:1:model`,
      },
    ]);
  });

  it('tells argo when the request records no requester', async () => {
    aWaitingRequest({ requestedBy: null });

    await tell();

    expect(fleet.state.told).toEqual([
      {
        text: `Ship scout waits: ${MODEL_REASON}\n\nShip scout's crew request (settings version 1) waits: ${MODEL_REASON}. It records no requester, so the trierarch plugin tells argo.`,
        idempotencyKey: `trierarch-plugin:crew-request-reason:${SCOUT}:1:model`,
      },
    ]);
  });

  it('opens what argo is told with a headline of at most 80 characters, then a blank line', async () => {
    aWaitingRequest({ requestedBy: null, reason: GIVEN_BACK_REASON, name: 'a-ship-with-a-long-name-for-the-headline' });

    await tell();

    const [headline, blank] = (fleet.state.told[0]?.text ?? '').split('\n');
    expect(headline?.length).toBeLessThanOrEqual(ARGO_HEADLINE_MAX_LENGTH);
    expect(blank).toBe('');
  });

  it('tells argo once across restarts of the trierarch plugin', async () => {
    aWaitingRequest({ requestedBy: null });

    await tell();
    await tell();

    expect(fleet.state.told).toHaveLength(1);
  });

  it('tells the requester next pass when the fleet did not answer the tell', async () => {
    aRequester();
    aWaitingRequest();
    const told = new Set<string>();
    fleet.state.isAnsweringSends = false;
    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 0, untold: 1, refused: 0 } });
    fleet.state.isAnsweringSends = true;

    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 1, untold: 0, refused: 0 } });
    expect(fleet.state.sent).toHaveLength(1);
  });

  it('tells argo next pass when the fleet did not answer the tell', async () => {
    aWaitingRequest({ requestedBy: null });
    const told = new Set<string>();
    fleet.state.isAnsweringSends = false;
    await tellWith(told)(FLEET_ID);
    fleet.state.isAnsweringSends = true;

    await tellWith(told)(FLEET_ID);

    expect(fleet.state.told).toHaveLength(1);
  });

  it('tells argo once, naming the refusal, when the fleet refuses the message to the requester, and tries it no more', async () => {
    aRequester();
    fleet.state.refusingSends.add(ORCHESTRATOR);
    aWaitingRequest();
    const told = new Set<string>();

    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 1, untold: 0, refused: 0 } });
    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 0, untold: 0, refused: 0 } });

    expect(fleet.state.sent).toEqual([]);
    expect(fleet.state.told).toEqual([
      {
        text: `Ship scout waits: ${MODEL_REASON}\n\nShip scout's crew request (settings version 1) waits: ${MODEL_REASON}. Ship orchestrator made it, and the fleet refused the message to it (FORBIDDEN: No network rule allows this message), so the trierarch plugin tells argo.`,
        idempotencyKey: `trierarch-plugin:crew-request-reason:${SCOUT}:1:model`,
      },
    ]);
  });

  it('tries no more a tell argo refuses, counting it refused', async () => {
    aWaitingRequest({ requestedBy: null });
    fleet.state.isRefusingArgo = true;
    const told = new Set<string>();

    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 0, untold: 0, refused: 1 } });
    fleet.state.isRefusingArgo = false;

    await expect(tellWith(told)(FLEET_ID)).resolves.toEqual({ isOk: true, value: { told: 0, untold: 0, refused: 0 } });
    expect(fleet.state.told).toEqual([]);
  });

  it('goes on with the other requests when one tell is refused', async () => {
    aRequester();
    fleet.state.ships.push({ shipId: LOOKOUT, name: 'lookout', type: 'orchestrator', status: 'crewed', lastSeenAt: AT, model: null, crewRequest: null, labels: [] });
    fleet.state.refusingSends.add(LOOKOUT);
    aWaitingRequest({ shipId: MAC, name: 'mac', requestedBy: { shipId: LOOKOUT, name: 'lookout' } });
    aWaitingRequest();

    await expect(tell()).resolves.toEqual({ isOk: true, value: { told: 2, untold: 0, refused: 0 } });
    expect(fleet.state.sent.map((message) => message.shipId)).toEqual([ORCHESTRATOR]);
    expect(fleet.state.told.map((notice) => notice.idempotencyKey)).toEqual([`trierarch-plugin:crew-request-reason:${MAC}:1:model`]);
  });

  it('refuses while the trierarch plugin is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(tell()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('refuses while the fleet does not answer the list', async () => {
    aWaitingRequest();
    fleet.state.isAnswering = false;

    await expect(tell()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
