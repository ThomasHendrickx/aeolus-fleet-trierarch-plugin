import type { ShipId } from '@aeolus-fleet/common';

import type { PluginDelivery } from '../connection/ports.js';
import { SECRETS_REQUEST_CONTENT_TYPE } from './secrets.js';

/** Whether a delivery to the plugin's ship asked for the secret store again; the next pass then seals it to its sender. */
export type ResendSecrets = (delivery: PluginDelivery) => boolean;

/**
 * Use case: a trierarch asks for the secret store again
 * (aeolus-fleet-trierarch#120), once per process, as it asks for the lists.
 * Its sender is forgotten from what this process sealed, so the next pass
 * seals the store to the key its report states, as to a trierarch never sent
 * it. The share pass sends only to trierarch ships, so another ship that asks
 * gets nothing.
 */
export function createResendSecrets(deps: { sealed: Map<ShipId, string> }): ResendSecrets {
  return (delivery) => {
    if (delivery.contentType !== SECRETS_REQUEST_CONTENT_TYPE) {
      return false;
    }
    deps.sealed.delete(delivery.senderShipId);
    return true;
  };
}
