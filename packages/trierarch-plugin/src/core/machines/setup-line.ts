import type { ShipId } from '@aeolus-fleet/common';

/** The trierarch's install script: it installs the binary, then runs `aeolus-trierarch init` with the flags it is given. */
const INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh';

/**
 * The one ready-to-run line that sets a machine up: the install script runs
 * `aeolus-trierarch init`, which takes the fleet's URL, the machine's ship and its secret, and the trierarch
 * plugin's own ship as flags and never parses a prompt. The trierarch takes
 * the trusted repositories only from that ship (aeolus-fleet#384): a ship's
 * type proves nothing. It holds the secret, so it is shown once, never kept.
 */
export function setupLineOf(parts: { fleetUrl: string; shipId: ShipId; pluginShipId: ShipId; secret: string }): string {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sh -s -- --fleet-url ${parts.fleetUrl} --ship-id ${parts.shipId} --plugin-ship-id ${parts.pluginShipId} --secret ${parts.secret}`;
}
