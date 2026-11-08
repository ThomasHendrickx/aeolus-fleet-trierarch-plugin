import type { ShipId } from '@aeolus-fleet/common';

import type { PluginDelivery } from '../connection/ports.js';
import { MCP_SERVERS_REQUEST_CONTENT_TYPE } from './mcp-servers.js';

/** Whether a delivery to the plugin's ship asked for the MCP servers again, which asks for the AIP again too; the next pass then sends it to its sender. */
export type ResendAip = (delivery: PluginDelivery) => boolean;

/**
 * Use case: a trierarch asks for the MCP servers again
 * (aeolus-fleet-trierarch#120), and gets the AIP again with them
 * (aeolus-fleet-trierarch-plugin#63). Its sender is forgotten from what this
 * process sent, so the next pass sends it the AIP as to a trierarch never sent
 * it.
 */
export function createResendAip(deps: { shared: Set<ShipId> }): ResendAip {
  return (delivery) => {
    if (delivery.contentType !== MCP_SERVERS_REQUEST_CONTENT_TYPE) {
      return false;
    }
    deps.shared.delete(delivery.senderShipId);
    return true;
  };
}
