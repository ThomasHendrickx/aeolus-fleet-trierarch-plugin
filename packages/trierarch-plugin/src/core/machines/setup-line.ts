import type { ShipId } from '@aeolus-fleet/common';

/** The trierarch's install script: it installs the binary, then runs `aeolus-trierarch init` with the flags it is given. */
const INSTALL_SCRIPT_URL = 'https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh';

/** The harnesses the trierarch's setup offers, each with an adapter (join design, decision 2). */
export const SETUP_HARNESSES = ['claude-code', 'codex', 'copilot'] as const;
export type SetupHarness = (typeof SETUP_HARNESSES)[number];

/** Where a machine's repositories come from: paths or git URLs, a folder of repositories, or none. Left out, the machine asks. */
export type RepositoriesChoice = { kind: 'list'; entries: readonly string[] } | { kind: 'folder'; path: string } | { kind: 'none' };

/** The options the setup line may carry; each left out is asked on the machine. */
export interface SetupOptions {
  harnesses?: readonly SetupHarness[];
  /** Harnesses that run without permission questions: only those picked in `harnesses` are carried. */
  unattended?: readonly SetupHarness[];
  repositories?: RepositoriesChoice;
}

/** One shell word that holds the value as it is: single quotes, a single quote inside closed, escaped and opened again. */
function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** The harnesses in the order of SETUP_HARNESSES, each once. */
function harnessesIn(wanted: readonly SetupHarness[], among: readonly SetupHarness[]): SetupHarness[] {
  return SETUP_HARNESSES.filter((harness) => wanted.includes(harness) && among.includes(harness));
}

/** The flags of the filled options; one left out has none, and `--clone-into` is never carried. */
function optionFlagsOf(options: SetupOptions): string[] {
  const harnesses = harnessesIn(options.harnesses ?? [], SETUP_HARNESSES);
  const unattended = harnessesIn(options.unattended ?? [], harnesses);
  const choice = options.repositories;
  const entries = choice?.kind === 'list' ? choice.entries.filter((entry) => entry !== '') : [];
  return [
    ...(harnesses.length > 0 ? [`--harnesses ${harnesses.join(',')}`] : []),
    ...(unattended.length > 0 ? [`--unattended ${unattended.join(',')}`] : []),
    ...(entries.length > 0 ? [`--repositories ${shellQuoted(entries.join(','))}`] : []),
    ...(choice?.kind === 'folder' ? [`--repositories-in ${shellQuoted(choice.path)}`] : []),
    ...(choice?.kind === 'none' ? ['--no-repositories'] : []),
  ];
}

/**
 * The one ready-to-run line that sets a machine up: the install script runs
 * `aeolus-trierarch init`, which takes the fleet's URL, the machine's ship and its secret, and the trierarch
 * plugin's own ship as flags and never parses a prompt. The trierarch takes
 * the trusted repositories only from that ship (aeolus-fleet#384): a ship's
 * type proves nothing. It holds the secret, so it is shown once, never kept.
 * Each option filled becomes its flag, so a line with all of them asks
 * nothing; each one left out is asked on the machine. A path or git URL is
 * shell-quoted, so no value can break out of the line.
 */
export function setupLineOf(parts: { fleetUrl: string; shipId: ShipId; pluginShipId: ShipId; secret: string }, options: SetupOptions = {}): string {
  const base = `curl -fsSL ${INSTALL_SCRIPT_URL} | sh -s -- --fleet-url ${parts.fleetUrl} --ship-id ${parts.shipId} --plugin-ship-id ${parts.pluginShipId} --secret ${parts.secret}`;
  return [base, ...optionFlagsOf(options)].join(' ');
}
