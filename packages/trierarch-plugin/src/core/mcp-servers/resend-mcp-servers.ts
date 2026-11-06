import type { ShipId } from '@aeolus-fleet/common';

import type { PluginDelivery } from '../connection/ports.js';
import { MCP_SERVERS_REQUEST_CONTENT_TYPE } from './mcp-servers.js';

/** Whether a delivery to the plugin's ship asked for the MCP servers again; the next pass then sends them to its sender. */
export type ResendMcpServers = (delivery: PluginDelivery) => boolean;

/**
 * Use case: a trierarch asks for the MCP servers again
 * (aeolus-fleet-trierarch#120), as one does when it starts knowing the trierarch
 * plugin's ship: a machine set up before took no list until init kept that
 * ship. Its sender is forgotten from what this process sent, so the next pass
 * sends it the list as to a trierarch never sent it. The share pass sends only
 * to trierarch ships, so another ship that asks gets nothing.
 */
export function createResendMcpServers(deps: { shared: Set<ShipId> }): ResendMcpServers {
  return (delivery) => {
    if (delivery.contentType !== MCP_SERVERS_REQUEST_CONTENT_TYPE) {
      return false;
    }
    deps.shared.delete(delivery.senderShipId);
    return true;
  };
}
