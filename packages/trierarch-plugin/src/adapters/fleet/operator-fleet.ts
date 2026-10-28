/**
 * The fleet's calls the trierarch plugin makes on behalf of the operator: its
 * tRPC procedures with the console session cookie the console's server
 * forwarded and the Origin the browser sent, as `console.session` is asked
 * (decisions 0033 and 0057). The fleet takes a state-changing call made with
 * the cookie only from the console's Origin, so a forwarded Origin from
 * anywhere else is refused there.
 */
import { startingPromptOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { OperatorFleet, OperatorSession } from '../../core/operator/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import type { FleetRefusal } from '../../core/connection/ports.js';

const TIMEOUT_MS = 10_000;

const answerSchema = z.union([
  z.object({ result: z.object({ data: z.unknown() }) }),
  z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }) }) }),
]);

async function mutation<T>(fleetUrl: string, call: { procedure: string; session: OperatorSession; input: unknown; answers: z.ZodType<T> }): Promise<Result<T, FleetRefusal>> {
  const headers: Record<string, string> = { cookie: call.session.cookie, 'content-type': 'application/json' };
  if (call.session.origin !== undefined) {
    headers.origin = call.session.origin;
  }
  let response: Response;
  try {
    response = await fetch(`${fleetUrl}/trpc/${call.procedure}`, { method: 'POST', headers, body: JSON.stringify(call.input), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return err({ code: 'UNAVAILABLE', message: `${call.procedure} got no answer` });
  }
  const answer = answerSchema.safeParse(await response.json().catch(() => undefined));
  if (!answer.success) {
    return err({ code: 'UNAVAILABLE', message: `${call.procedure} answered no tRPC answer (${String(response.status)})` });
  }
  if ('error' in answer.data) {
    return err({ code: answer.data.error.data.code, message: answer.data.error.message });
  }
  return ok(call.answers.parse(answer.data.result.data));
}

export function createOperatorFleet(fleetUrl: string): OperatorFleet {
  return {
    release: async (session, ship) => {
      const released = await mutation(fleetUrl, { procedure: 'fleet.release', session, input: ship, answers: z.unknown() });
      return released.isOk ? ok(undefined) : released;
    },
    getStartingPrompt: async (session, ship) => {
      const issued = await mutation(fleetUrl, { procedure: 'fleet.getStartingPrompt', session, input: ship, answers: startingPromptOutputSchema });
      return issued.isOk ? ok({ prompt: issued.value.prompt, crewLines: issued.value.crewLines, secret: issued.value.secret }) : issued;
    },
  };
}
