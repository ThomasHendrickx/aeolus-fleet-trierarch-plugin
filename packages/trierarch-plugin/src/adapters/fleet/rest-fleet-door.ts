/**
 * The fleet's ship calls over its REST API (`/api/v1`), as any ship that is
 * not TypeScript-bound may make them: the trierarch plugin uses the public API
 * like any client (decision 0030). A refusal reads as the fleet's code and
 * message.
 */
import { commissionShipOutputSchema, fleetListOutputSchema, idSchema, shipDetailOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { FleetDoor, FleetRefusal } from '../../core/connection/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';

const refusalSchema = z.object({ code: z.string(), message: z.string() });

/** Where the trierarch plugin says its ship runs: on a server the operator runs. */
const LOCATION = { kind: 'SERVER' } as const;

/** The harness the trierarch plugin states when it registers its ship: it is software, not a model. */
const HARNESS = 'aeolus-trierarch-plugin';

async function call<T>(fleetUrl: string, request: { path: string; method: 'GET' | 'POST'; crewToken?: string; body?: unknown; answers: z.ZodType<T> }): Promise<Result<T, FleetRefusal>> {
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

export function createRestFleetDoor(fleetUrl: string): FleetDoor {
  return {
    register: ({ shipId, secret }) =>
      call(fleetUrl, { path: '/ship/register', method: 'POST', body: { shipId, secret, location: LOCATION, harness: HARNESS }, answers: z.object({ crewToken: z.string() }) }),
    whoami: (crewToken) =>
      call(fleetUrl, {
        path: '/ship/whoami',
        method: 'GET',
        crewToken,
        answers: z.object({ shipId: idSchema('ship'), fleetId: idSchema('fleet'), name: z.string(), type: z.string() }),
      }),
    getShip: async (crewToken, ship) => {
      const read = await call(fleetUrl, { path: '/fleet/ship', method: 'POST', crewToken, body: ship, answers: shipDetailOutputSchema });
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
      const ended = await call(fleetUrl, { path: '/ship/deregister', method: 'POST', crewToken, body: {}, answers: z.unknown() });
      return ended.isOk ? ok(undefined) : ended;
    },
    commission: async (crewToken, ship) => {
      const commissioned = await call(fleetUrl, { path: '/fleet/commission', method: 'POST', crewToken, body: ship, answers: commissionShipOutputSchema });
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
      const listed = await call(fleetUrl, { path: '/fleet/list', method: 'GET', crewToken, answers: fleetListOutputSchema });
      return listed.isOk
        ? ok(
            listed.value.map(({ id, name, type, status, lastSeenAt, crewRequest }) => ({
              shipId: id,
              name,
              type,
              status,
              lastSeenAt: dateOf(lastSeenAt),
              crewRequest: crewRequest && { requestedAt: new Date(crewRequest.requestedAt), assignedTo: crewRequest.assignedTo?.id ?? null, reason: crewRequest.reason },
            })),
          )
        : listed;
    },
    assignCrew: async (crewToken, claim) => {
      const claimed = await call(fleetUrl, { path: '/fleet/assignCrew', method: 'POST', crewToken, body: claim, answers: z.unknown() });
      return claimed.isOk ? ok(undefined) : claimed;
    },
    explainCrewRequest: async (crewToken, explanation) => {
      const explained = await call(fleetUrl, { path: '/fleet/explainCrewRequest', method: 'POST', crewToken, body: explanation, answers: z.unknown() });
      return explained.isOk ? ok(undefined) : explained;
    },
  };
}
