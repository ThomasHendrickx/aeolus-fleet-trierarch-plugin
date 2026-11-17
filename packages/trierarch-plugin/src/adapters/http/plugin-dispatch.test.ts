import type { PluginCallContext } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createPluginDispatch } from './plugin-dispatch.js';

const context: PluginCallContext = { fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8sv', pluginShipId: 'shp_01m3tbfspe96yf1rnr4ank9h4a', requestId: '8c9d988f-b8ab-410d-80cf-b11b0c9f5fb4', actor: { kind: 'installation' }, scopes: [], procedure: 'example', input: {}, expiresAt: '2026-11-18T12:00:20.000Z' };
const secret = 'a-long-enough-example-secret-for-test';
function dispatch() {
  const reserved = new Set<string>();
  return createPluginDispatch({ secrets: [secret, 'another-long-example-secret-for-test'], now: () => new Date('2026-11-18T12:00:00.000Z'), connected: () => Promise.resolve(context.pluginShipId), isServed: () => Promise.resolve(true), reservations: { reserve: ({ requestId }) => { if (reserved.has(requestId)) return Promise.resolve(false); reserved.add(requestId); return Promise.resolve(true); } }, procedures: { example: () => Promise.resolve({ result: { data: 'ok' } }) } });
}

describe('internal plugin dispatch', () => {
  it('admits an authenticated dispatch once', async () => {
    const call = dispatch();
    await expect(call(context, secret)).resolves.toEqual({ result: { data: 'ok' } });
    await expect(call(context, secret)).resolves.toEqual({ error: { data: { code: 'CONFLICT' } } });
  });
  it('refuses a missing or wrong secret', async () => {
    await expect(dispatch()(context, undefined)).resolves.toEqual({ error: { data: { code: 'UNAUTHORIZED' } } });
    await expect(dispatch()(context, 'wrong')).resolves.toEqual({ error: { data: { code: 'UNAUTHORIZED' } } });
  });
  it('refuses an unknown destination and an expired context', async () => {
    await expect(dispatch()({ ...context, pluginShipId: 'shp_01m3tbfspe96yf1rnr4ank9h4b' }, secret)).resolves.toEqual({ error: { data: { code: 'UNAUTHORIZED' } } });
    await expect(dispatch()({ ...context, expiresAt: '2026-11-18T11:59:59.000Z' }, secret)).resolves.toEqual({ error: { data: { code: 'UNAUTHORIZED' } } });
  });
  it('refuses a procedure outside the exposed set', async () => {
    await expect(dispatch()({ ...context, procedure: 'installation.delete' }, secret)).resolves.toEqual({ error: { data: { code: 'NOT_FOUND' } } });
  });
});
