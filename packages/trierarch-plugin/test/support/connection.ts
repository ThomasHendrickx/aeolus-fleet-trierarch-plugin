import type { ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { FLEET_URL, OPERATOR } from '../../../core/test/support/core-fixtures.js';

/** Signs the operator in to the fleet's console: the session cookie the console's server forwards. */
export async function signIn(fleetUrl: string): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
    body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }),
  });
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

/** Calls one of the trierarch plugin's mutations with the operator's cookie, as the console's server does. */
export function mutate(address: string, request: { procedure: string; cookie: string; body: unknown }): Promise<Response> {
  return fetch(`${address}/trpc/${request.procedure}`, {
    method: 'POST',
    headers: { cookie: request.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  });
}

/** Calls one of the trierarch plugin's queries with the operator's cookie. */
export function query(address: string, request: { procedure: string; cookie: string; input?: unknown }): Promise<Response> {
  const search = request.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(request.input))}`;
  return fetch(`${address}/trpc/${request.procedure}${search}`, { headers: { cookie: request.cookie } });
}

/** Connects the trierarch plugin with its ship's secret, as the console's server does. */
export function connectPlugin(address: string, request: { cookie: string; shipId: ShipId; secret: string }): Promise<Response> {
  return mutate(address, { procedure: 'connection.connect', cookie: request.cookie, body: { shipId: request.shipId, secret: request.secret } });
}
