import type { ShipId } from '@aeolus-fleet/common';

/** The package a machine sets up its trierarch with. */
const TRIERARCH_PACKAGE = '@aeolus-fleet/trierarch';

/**
 * The one ready-to-run line that sets a machine up: `aeolus-trierarch init`
 * takes the fleet's URL, the machine's ship and its secret, and the trierarch
 * plugin's own ship as flags and never parses a prompt. The trierarch takes
 * the trusted repositories only from that ship (aeolus-fleet#384): a ship's
 * type proves nothing. It holds the secret, so it is shown once, never kept.
 */
export function setupLineOf(parts: { fleetUrl: string; shipId: ShipId; pluginShipId: ShipId; secret: string }): string {
  return `npx ${TRIERARCH_PACKAGE} init --fleet-url ${parts.fleetUrl} --ship-id ${parts.shipId} --plugin-ship-id ${parts.pluginShipId} --secret ${parts.secret}`;
}
