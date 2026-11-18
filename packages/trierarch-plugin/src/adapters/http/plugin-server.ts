import Fastify from 'fastify';

import type { createPluginDispatch } from './plugin-dispatch.js';

/** A separate listener with no public cookie or installation procedures. */
export function createPluginServer(dispatch: ReturnType<typeof createPluginDispatch>) {
  const server = Fastify({ logger: false });
  server.post('/dispatch', (request) => {
    const header = request.headers['aeolus-plugin-secret'];
    return dispatch(request.body, typeof header === 'string' ? header : undefined);
  });
  return server;
}
