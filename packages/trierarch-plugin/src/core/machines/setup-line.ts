import type { ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

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
  folders?: { kind: 'list'; entries: readonly { name: string; path: string }[] } | { kind: 'none' };
  maxShips?: number;
  maxRunning?: number;
  service?: 'yes' | 'no';
}

export type SetupOptionsRefusal = DomainError<'INVALID_SETUP_OPTION'>;

/**
 * The trierarch reads `--repositories` as one value split at a comma or a
 * semicolon (aeolus-fleet-trierarch, repositoryselection.go), and a repeated
 * flag keeps only its last value: an entry holding either delimiter could not
 * be told as given, so it is refused. `--repositories-in` is one path and is
 * not split: it takes any character. A NUL ends a shell word, so none is taken.
 */
export function checkedSetupOptions(options: SetupOptions): Result<SetupOptions, SetupOptionsRefusal> {
  const folders = options.folders?.kind === 'list' ? options.folders.entries : [];
  if (folders.some(({ name, path }) => name.includes('\0') || path.includes('\0'))) {
    return refuse('INVALID_SETUP_OPTION', 'A folder name or path holds no NUL');
  }
  if ([options.maxShips, options.maxRunning].some((limit) => limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0))) {
    return refuse('INVALID_SETUP_OPTION', 'Ship and session limits are whole numbers greater than zero');
  }
  const choice = options.repositories;
  const values = choice?.kind === 'list' ? choice.entries : choice?.kind === 'folder' ? [choice.path] : [];
  if (values.some((value) => value.includes('\0'))) {
    return refuse('INVALID_SETUP_OPTION', 'A repository path or git URL holds no NUL');
  }
  if (choice?.kind === 'list') {
    for (const [delimiter, name] of [[',', 'comma'], [';', 'semicolon']] as const) {
      if (choice.entries.some((entry) => entry.includes(delimiter))) {
        return refuse('INVALID_SETUP_OPTION', `A repository path or git URL holds no ${name}: the trierarch splits the list there`);
      }
    }
  }
  return ok(options);
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
    ...(options.folders?.kind === 'list' ? options.folders.entries.map(({ name, path }) => `--folder ${shellQuoted(name)} ${shellQuoted(path)}`) : []),
    ...(options.folders?.kind === 'none' ? ['--no-folders'] : []),
    ...(options.maxShips !== undefined ? [`--max-ships ${options.maxShips}`] : []),
    ...(options.maxRunning !== undefined ? [`--max-running ${options.maxRunning}`] : []),
    ...(options.service !== undefined ? [`--service ${options.service}`] : []),
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
 * shell-quoted, so no value can break out of the line; a list entry the
 * trierarch would split is refused (checkedSetupOptions).
 */
export function setupLineOf(parts: { fleetUrl: string; shipId: ShipId; pluginShipId: ShipId; secret: string }, options: SetupOptions = {}): Result<string, SetupOptionsRefusal> {
  const checked = checkedSetupOptions(options);
  if (!checked.isOk) {
    return checked;
  }
  const base = `curl -fsSL ${INSTALL_SCRIPT_URL} | sh -s -- --fleet-url ${parts.fleetUrl} --ship-id ${parts.shipId} --plugin-ship-id ${parts.pluginShipId} --secret ${parts.secret}`;
  return ok([base, ...optionFlagsOf(checked.value)].join(' '));
}
