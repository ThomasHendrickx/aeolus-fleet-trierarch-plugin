import { describe, expect, it } from 'vitest';

import { createPluginServer } from './plugin-server.js';

describe('the internal plugin server', () => {
  it('passes the secret header and JSON body to the dispatch boundary', async () => {
    const received: { body: unknown; secret: string | undefined }[] = [];
    const server = createPluginServer((body, secret) => { received.push({ body, secret }); return Promise.resolve({ result: { data: 'ok' } }); });
    const response = await server.inject({ method: 'POST', url: '/dispatch', headers: { 'aeolus-plugin-secret': 'test-secret' }, payload: { procedure: 'repositories.list' } });
    expect(response.json()).toEqual({ result: { data: 'ok' } });
    expect(received).toEqual([{ body: { procedure: 'repositories.list' }, secret: 'test-secret' }]);
    await server.close();
  });
  it('does not expose public tRPC procedures', async () => {
    const server = createPluginServer(() => Promise.resolve({ error: { data: { code: 'NOT_FOUND' } } }));
    expect((await server.inject({ method: 'POST', url: '/trpc/installation.delete', payload: {} })).statusCode).toBe(404);
    await server.close();
  });
});
