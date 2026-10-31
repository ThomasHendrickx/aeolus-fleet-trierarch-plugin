/**
 * Asks the fleet whether a forwarded console session cookie is a signed-in
 * operator's or a viewer's, with its scopes, with `console.session`
 * (decisions 0012 and 0022): the cookie travels from the console's server,
 * server to server.
 */
import { consoleSessionOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ConsoleSessions } from '../../core/operator/ports.js';
import { err, ok } from '../../core/shared/result.js';

// Only what the plugin reads: a core older than common's schema answers fewer fields (MINIMUM_CORE_VERSION).
const sessionAnswer = z.object({ result: z.object({ data: consoleSessionOutputSchema.pick({ fleetId: true, kind: true, scopes: true }) }) });

export function createFleetConsoleSessions(fleetUrl: string): ConsoleSessions {
  return {
    check: async (cookie) => {
      const response = await fetch(`${fleetUrl}/trpc/console.session`, { headers: { cookie } });
      if (!response.ok) {
        return err({ code: 'UNAUTHORIZED', message: 'No signed-in console session' });
      }
      const { fleetId, kind, scopes } = sessionAnswer.parse(await response.json()).result.data;
      return ok({ fleetId, kind, scopes });
    },
  };
}
