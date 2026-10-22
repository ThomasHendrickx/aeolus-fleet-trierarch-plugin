/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: the trierarch plugin uses the public API
 * like any client (decision 0030). A refusal reads as the fleet's code and
 * message. While the fleet is busy (nothing stored), each call is made again
 * by itself with the same body, after each of the busy waits (each drawn by
 * `busyWaitMs`), so a send keeps its idempotency key.
 */
import { setTimeout as wait } from 'node:timers/promises';

import { busyWaitMs, commissionShipOutputSchema, declareNetworkRulesOutputSchema, declareScopesOutputSchema, defineLabelOutputSchema, FLEET_BUSY_WAITS_MS, fleetListOutputSchema, idSchema, isInReadReach, labelsOutputSchema, receiveOutputSchema, scopesOutputSchema, shipDetailOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal, PluginInbox } from '../../core/connection/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** The fleet's code for a call it could not start: nothing was stored, so the same call may be made again. */
const FLEET_BUSY = 'SERVICE_UNAVAILABLE';

/** Where the trierarch plugin says its ship runs: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

/** The harness the trierarch plugin states when it registers its ship: it is software, not a model. */
const HARNESS = 'aeolus-trierarch-plugin';

/** The operator ship's name (decision 0012). */
const OPERATOR_SHIP_NAME = 'argo';

/** One call to the fleet. */
interface FleetCall<T> {
  path: string;
  method: 'GET' | 'POST';
  crewToken?: string;
  body?: unknown;
  answers: z.ZodType<T>;
}

/** Where the fleet answers, how long to wait before each next call while it is busy, the draw for each wait, and how a drawn wait is waited. */
interface Door {
  fleetUrl: string;
  busyWaitsMs: readonly number[];
  random: () => number;
  wait: (waitMs: number, signal?: AbortSignal) => Promise<void>;
}

async function callFleet<T>({ fleetUrl, busyWaitsMs, random, wait: waitBusy }: Door, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
  for (const waitMs of busyWaitsMs) {
    const answered = await callOnce(fleetUrl, request);
    if (answered.isOk || answered.error.code !== FLEET_BUSY) {
      return answered;
    }
    await waitBusy(busyWaitMs(waitMs, random));
  }
  return callOnce(fleetUrl, request);
}

async function callOnce<T>(fleetUrl: string, request: FleetCall<T>): Promise<Result<T, FleetRefusal>> {
  const headers: Record<string, string> = {};
  if (request.crewToken !== undefined) {
    headers.authorization = `Bearer ${request.crewToken}`;
  }
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${fleetUrl}/api/v1${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    body = await response.json();
  } catch (error) {
    return err({ code: 'UNAVAILABLE', message: `The fleet did not answer: ${error instanceof Error ? error.message : String(error)}` });
  }
  return response.ok ? ok(request.answers.parse(body)) : err(refusalSchema.parse(body));
}

function dateOf(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

export function createRestFleetDoor(fleetUrl: string, options: { busyWaitsMs?: readonly number[]; random?: () => number; wait?: (waitMs: number, signal?: AbortSignal) => Promise<void> } = {}): FleetDoor & { inbox: PluginInbox } {
  const door = { fleetUrl, busyWaitsMs: options.busyWaitsMs ?? FLEET_BUSY_WAITS_MS, random: options.random ?? Math.random, wait: options.wait ?? ((waitMs: number) => wait(waitMs)) };
  const call = <T>(request: FleetCall<T>) => callFleet(door, request);
  return {
    register: ({ shipId, secret }) =>
      call({ path: '/ship/register', method: 'POST', body: { shipId, secret, location: LOCATION, harness: HARNESS }, answers: z.object({ crewToken: z.string() }) }),
    whoami: (crewToken) =>
      call({
        path: '/ship/whoami',
        method: 'GET',
        crewToken,
        answers: z.object({ shipId: idSchema('ship'), fleetId: idSchema('fleet'), name: z.string(), type: z.string() }),
      }),
    getShip: async (crewToken, ship) => {
      const read = await call({ path: '/fleet/ship', method: 'POST', crewToken, body: ship, answers: shipDetailOutputSchema });
      if (!read.isOk) {
        return read;
      }
      const { status, scopes, commissionedAt, report, crewRequest } = read.value;
      return ok({
        status,
        scopes,
        commissionedAt: new Date(commissionedAt),
        report: report && { state: report.state, note: report.note, reportedAt: new Date(report.reportedAt), details: report.details },
        crewSettings: crewRequest?.settings ?? null,
      });
    },
    deregister: async (crewToken) => {
      const ended = await call({ path: '/ship/deregister', method: 'POST', crewToken, body: {}, answers: z.unknown() });
      return ended.isOk ? ok(undefined) : ended;
    },
    commission: async (crewToken, ship) => {
      const commissioned = await call({ path: '/fleet/commission', method: 'POST', crewToken, body: ship, answers: commissionShipOutputSchema });
      if (!commissioned.isOk) {
        return commissioned;
      }
      const { shipId, prompt, crewLines, secret } = commissioned.value;
      // A new key always answers the starting prompt; a repeat of an earlier key does not, and the plugin never repeats one.
      if (prompt === null || crewLines === null || secret === null) {
        return err({ code: 'CONFLICT', message: 'The fleet answered an earlier commission under this idempotency key' });
      }
      return ok({ shipId, prompt, crewLines, secret });
    },
    listShips: async (crewToken) => {
      const listed = await call({ path: '/fleet/list', method: 'POST', crewToken, body: {}, answers: fleetListOutputSchema });
      return listed.isOk
        ? ok(
            // A ship outside read reach shows too little to crew (decision 0034).
            listed.value.filter(isInReadReach).map(({ id, name, type, status, lastSeenAt, model, crewRequest, labels }) => ({
              shipId: id,
              name,
              type,
              status,
              lastSeenAt: dateOf(lastSeenAt),
              model: model && { id: model.id, statedAt: new Date(model.statedAt) },
              crewRequest: crewRequest && {
                settingsVersion: crewRequest.settingsVersion,
                requestedAt: new Date(crewRequest.requestedAt),
                assignedTo: crewRequest.assignedTo?.id ?? null,
                reason: crewRequest.reason,
                startedAt: dateOf(crewRequest.startedAt),
                givenBack: crewRequest.givenBack.map((back) => ({ trierarchShipId: back.trierarch.id, reason: back.reason })),
              },
              labels: labels.map(({ labelId, valueId }) => ({ labelId, valueId })),
            })),
          )
        : listed;
    },
    assignCrew: async (crewToken, claim) => {
      const claimed = await call({ path: '/fleet/assignCrew', method: 'POST', crewToken, body: claim, answers: z.unknown() });
      return claimed.isOk ? ok(undefined) : claimed;
    },
    listLabels: async (crewToken) => {
      const listed = await call({ path: '/fleet/labels', method: 'GET', crewToken, answers: labelsOutputSchema });
      return listed.isOk
        ? ok(listed.value.map(({ id, key, values, owner }) => ({ labelId: id, key, values: values.map((value) => ({ valueId: value.id, value: value.value })), ownerShipId: owner.kind === 'ship' ? owner.id : null })))
        : listed;
    },
    defineLabel: async (crewToken, label) => {
      const defined = await call({ path: '/fleet/defineLabel', method: 'POST', crewToken, body: label, answers: defineLabelOutputSchema });
      return defined.isOk ? ok({ labelId: defined.value.labelId, values: defined.value.values.map((value) => ({ valueId: value.id, value: value.value })) }) : defined;
    },
    assignLabel: async (crewToken, assignment) => {
      const assigned = await call({ path: '/fleet/assignLabel', method: 'POST', crewToken, body: assignment, answers: z.unknown() });
      return assigned.isOk ? ok(undefined) : assigned;
    },
    unassignLabel: async (crewToken, assignment) => {
      const unassigned = await call({ path: '/fleet/unassignLabel', method: 'POST', crewToken, body: assignment, answers: z.unknown() });
      return unassigned.isOk ? ok(undefined) : unassigned;
    },
    explainCrewRequest: async (crewToken, explanation) => {
      const explained = await call({ path: '/fleet/explainCrewRequest', method: 'POST', crewToken, body: explanation, answers: z.unknown() });
      return explained.isOk ? ok(undefined) : explained;
    },
    declareNetworkRules: (crewToken, declaration) =>
      call({ path: '/fleet/declareNetworkRules', method: 'POST', crewToken, body: declaration, answers: declareNetworkRulesOutputSchema }),
    listScopes: async (crewToken) => {
      const listed = await call({ path: '/fleet/scopes', method: 'GET', crewToken, answers: scopesOutputSchema });
      return listed.isOk ? ok(listed.value.map(({ namespace, declaredBy }) => ({ namespace, declaredBy: declaredBy?.id ?? null }))) : listed;
    },
    declareScopes: async (crewToken, declaration) => {
      const declared = await call({ path: '/fleet/declareScopes', method: 'POST', crewToken, body: declaration, answers: declareScopesOutputSchema });
      return declared.isOk ? ok(undefined) : declared;
    },
    tellArgo: async (crewToken, { text, idempotencyKey }) => {
      const sent = await call({
        path: '/ship/send',
        method: 'POST',
        crewToken,
        body: { selector: { kind: 'ship', name: OPERATOR_SHIP_NAME }, payload: text, contentType: 'text/plain', idempotencyKey },
        answers: z.unknown(),
      });
      return sent.isOk ? ok(undefined) : sent;
    },
    // The plugin's own ship's deliveries: argo's ping, and whatever else reaches it.
    inbox: {
      receive: async (crewToken, max) => {
        const taken = await call({ path: '/ship/receive', method: 'POST', crewToken, body: { max }, answers: receiveOutputSchema });
        return taken.isOk ? ok(taken.value.deliveries.map(({ deliveryId, contentType, senderShipId }) => ({ deliveryId, contentType, senderShipId }))) : taken;
      },
      ack: async (crewToken, deliveryId) => {
        const acked = await call({ path: '/ship/ack', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
        return acked.isOk ? ok(undefined) : acked;
      },
      pong: async (crewToken, deliveryId) => {
        const ponged = await call({ path: '/ship/pong', method: 'POST', crewToken, body: { deliveryId }, answers: z.unknown() });
        return ponged.isOk ? ok(undefined) : ponged;
      },
    },
  };
}
