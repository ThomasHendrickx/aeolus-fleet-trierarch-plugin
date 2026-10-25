import { CREW_REQUEST_REASON_MAX_LENGTH, NO_MACHINE_MATCHES_REASON, readCrewSettings, type CrewSettings, type ShipId, type TrierarchReportDetails } from '@aeolus-fleet/common';
import { z } from 'zod';

/** An unassigned crew request whose ship awaits crew: its settings as the fleet holds them, and the reason written on it now. */
export interface PlacementRequest {
  shipId: ShipId;
  requestedAt: Date;
  /** Unread: placement parses them as crew settings. */
  settings: unknown;
  reason: string | null;
  /** The trierarchs that gave it back, oldest first, and why (#382): placement leaves them out. */
  givenBack: readonly { trierarchShipId: ShipId; reason: string }[];
}

/** A trierarch that may take requests: one that reports details and is not silent. */
export interface PlacementTrierarch {
  shipId: ShipId;
  commissionedAt: Date;
  details: TrierarchReportDetails;
  /** The requests assigned to it now. */
  assigned: number;
  /** The label values its ship carries, every owner's: what a request's machine labels match (#102). */
  labelValueIds: readonly string[];
}

/**
 * What placement places by: the fleet's trierarchs as they are now, and the
 * fleet's enabled models (model governance, M1): exact model ids, none being
 * no rule.
 */
export interface PlacementFleet {
  trierarchs: readonly PlacementTrierarch[];
  enabledModels: readonly string[];
}

/** What placement decides for a request: the trierarch to claim it for, or why none fits. */
export type Placement = { kind: 'assign'; shipId: ShipId; trierarchShipId: ShipId } | { kind: 'explain'; shipId: ShipId; reason: string };

/**
 * What a settings check answers before a request is made: a trierarch fits;
 * none takes them, naming the settings field at fault; or they fit, but no
 * trierarch has room now, so a request would wait.
 */
export type PlacementCheck = { kind: 'fits' } | { kind: 'refused'; field: string; reason: string } | { kind: 'noRoom'; reason: string };

/** Why no trierarch fits: the settings field at fault, or none when the settings fit but there is no room. */
interface Misfit {
  reason: string;
  field?: string;
}

type Issue = z.core.$ZodIssue;

/** An issue as one line: its path, when it has one, and its message. */
function lineOf(issue: Issue, prefix: string[] = []): string {
  const path = [...prefix, ...issue.path.map(String)].join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}

/** The options the harness's schema declares, by name: an option it does not declare is ignored (#366). */
function declaredOptions(schema: TrierarchReportDetails['harnesses'][number]['options']): readonly string[] {
  const { properties } = schema;
  return typeof properties === 'object' && properties !== null && !Array.isArray(properties) ? Object.keys(properties) : [];
}

/**
 * Why the harness's options schema refuses the options, or undefined when it
 * takes them. Only the options it declares are checked; the rest are ignored
 * (#366). A schema it cannot read refuses them all.
 */
function optionsRefusal(schema: TrierarchReportDetails['harnesses'][number]['options'], options: CrewSettings['options']): string | undefined {
  let checked: z.ZodType;
  try {
    checked = z.fromJSONSchema(schema);
  } catch {
    return 'options: the trierarch reports an options schema that cannot be read';
  }
  const declared = declaredOptions(schema);
  const result = checked.safeParse(Object.fromEntries(Object.entries(options).filter(([name]) => declared.includes(name))));
  const [issue] = result.success ? [] : result.error.issues;
  return issue === undefined ? undefined : lineOf(issue, ['options']);
}

function offersWorkspace(details: TrierarchReportDetails, workspace: CrewSettings['workspace']): boolean {
  return workspace.kind === 'worktree' ? details.workspaces.repositories.includes(workspace.repository) : details.workspaces.folders.includes(workspace.name);
}

function workspaceName(workspace: CrewSettings['workspace']): string {
  return workspace.kind === 'worktree' ? `repository ${workspace.repository}` : `folder ${workspace.name}`;
}

/** A harness options schema that reports a default model (`properties.model.default`). */
const defaultModelSchema = z.object({ properties: z.object({ model: z.object({ default: z.string() }) }) });

/** Whether the harness reports a default model and the fleet enabled it: a harness with no default or no model option does not. */
function isDefaultEnabled(schema: TrierarchReportDetails['harnesses'][number]['options'], enabledModels: readonly string[]): boolean {
  const read = defaultModelSchema.safeParse(schema);
  return read.success && enabledModels.includes(read.data.properties.model.default);
}

/** Why a request waits on a model the fleet did not enable, within what a reason may hold. */
function modelDisabledReason(what: string): string {
  return `model disabled: ${what}`.slice(0, CREW_REQUEST_REASON_MAX_LENGTH);
}

/**
 * Why a request naming a model the fleet did not enable waits, or undefined
 * when the fleet has no rule or the model is enabled (M3): checked before any
 * trierarch.
 */
function namedModelRefusal(settings: CrewSettings, enabledModels: readonly string[]): Misfit | undefined {
  const named = settings.options.model;
  if (enabledModels.length === 0 || named === undefined || (typeof named === 'string' && enabledModels.includes(named))) {
    return undefined;
  }
  return { reason: modelDisabledReason(typeof named === 'string' ? named : JSON.stringify(named)), field: 'options' };
}

/** Room left as a share of its cap: what placement compares. */
function roomShare(trierarch: PlacementTrierarch): number {
  return (trierarch.details.caps.ships - trierarch.assigned) / trierarch.details.caps.ships;
}

/** Why a request waits when every trierarch that fits gave it back: the last reason, within what a reason may hold. */
function givenBackReason(givenBack: readonly { reason: string }[]): string {
  const last = givenBack.at(-1)?.reason ?? '';
  return `given back by every trierarch that fits; last: ${last}`.slice(0, CREW_REQUEST_REASON_MAX_LENGTH);
}

/**
 * The trierarch to claim for the settings, or why none fits: a named model
 * the fleet did not enable, first (M3); machine labels, harness (the named
 * one, or each trierarch's default), workspace, options; an enabled default
 * model for a request naming none; then the trierarchs that gave the request
 * back (#382), then room.
 */
function fit(settings: CrewSettings, { trierarchs, enabledModels, givenBack }: PlacementFleet & { givenBack: PlacementRequest['givenBack'] }): { trierarch: PlacementTrierarch } | Misfit {
  const disabled = namedModelRefusal(settings, enabledModels);
  if (disabled !== undefined) {
    return disabled;
  }
  if (trierarchs.length === 0) {
    return { reason: 'no trierarch reports yet' };
  }
  const machineLabels = settings.machineLabels ?? [];
  const matching = trierarchs.filter((trierarch) => machineLabels.every((valueId) => trierarch.labelValueIds.includes(valueId)));
  if (matching.length === 0) {
    // Allowed, not refused (#102, Q8): the request waits until a machine carries them all.
    return { reason: NO_MACHINE_MATCHES_REASON };
  }
  // Without a harness, each trierarch crews with its default: the first it reports (#343).
  const named = settings.harness;
  const harnessWords = named ?? 'its default harness';
  const offering = matching.flatMap((trierarch) => {
    const harness = named === undefined ? trierarch.details.harnesses[0] : trierarch.details.harnesses.find((each) => each.harness === named);
    return harness === undefined ? [] : [{ trierarch, harness }];
  });
  if (offering.length === 0) {
    return { reason: named === undefined ? 'no trierarch offers a harness' : `no trierarch offers harness ${named}`, field: 'harness' };
  }
  const withWorkspace = offering.filter(({ trierarch }) => offersWorkspace(trierarch.details, settings.workspace));
  if (withWorkspace.length === 0) {
    return { reason: `no trierarch offering ${harnessWords} has ${workspaceName(settings.workspace)}`, field: 'workspace' };
  }
  const refusals = withWorkspace.map(({ trierarch, harness }) => ({ trierarch, harness, refusal: optionsRefusal(harness.options, settings.options) }));
  const taking = refusals.filter(({ refusal }) => refusal === undefined);
  const [firstRefusal] = refusals;
  if (taking.length === 0) {
    return { reason: `no trierarch takes these options for ${harnessWords}: ${firstRefusal?.refusal ?? ''}`, field: 'options' };
  }
  // A request naming no model runs on the harness's default: only an enabled one fits (M3).
  const allowed = enabledModels.length === 0 || settings.options.model !== undefined ? taking : taking.filter(({ harness }) => isDefaultEnabled(harness.options, enabledModels));
  if (allowed.length === 0) {
    return { reason: modelDisabledReason(`no enabled default model for ${harnessWords}`), field: 'options' };
  }
  const left = allowed.map(({ trierarch }) => trierarch).filter((trierarch) => !givenBack.some((back) => back.trierarchShipId === trierarch.shipId));
  if (left.length === 0) {
    return { reason: givenBackReason(givenBack) };
  }
  const [best] = left
    .filter((trierarch) => trierarch.assigned < trierarch.details.caps.ships)
    .sort((first, second) => roomShare(second) - roomShare(first) || first.commissionedAt.getTime() - second.commissionedAt.getTime() || first.shipId.localeCompare(second.shipId));
  return best === undefined ? { reason: `no trierarch with room: all ${String(left.length)} that fit are full` } : { trierarch: best };
}

/** The settings as crew settings, or why not: common's reading, the one the fleet refuses a request by (#809). */
function parsed(settings: unknown): { settings: CrewSettings } | Misfit {
  const read = readCrewSettings(settings);
  return 'refusal' in read ? read.refusal : read;
}

/**
 * Policy: whether settings would be placed now, before anything is requested
 * (#245): by the same rules as placement, against the trierarchs as they are.
 */
export function checkPlacement(settings: unknown, fleet: PlacementFleet): PlacementCheck {
  const read = parsed(settings);
  const fitted = 'settings' in read ? fit(read.settings, { ...fleet, givenBack: [] }) : read;
  if ('trierarch' in fitted) {
    return { kind: 'fits' };
  }
  return fitted.field === undefined ? { kind: 'noRoom', reason: fitted.reason } : { kind: 'refused', field: fitted.field, reason: fitted.reason };
}

/**
 * Policy: where each unassigned request goes (docs/trierarch.md,
 * "Assignment"). Oldest request first; in a fleet that enabled models, only
 * a request whose model is enabled, or that names none and runs on an enabled
 * default (model governance, M3). Each to a trierarch whose ship
 * carries every machine label it names, that offers its harness and workspace, takes its options against the schema it reports for
 * that harness, did not give it back (#382), and has room (its cap above the requests assigned to it);
 * of those, the most room as a share of its cap, then the oldest. What it
 * assigns counts against the room of later requests in the same pass. A
 * request none fits gets the reason, unless that reason is written already.
 */
export function place(requests: readonly PlacementRequest[], { trierarchs, enabledModels }: PlacementFleet): Placement[] {
  const assigned = new Map(trierarchs.map((trierarch) => [trierarch.shipId, trierarch.assigned]));
  const placements: Placement[] = [];
  const oldestFirst = [...requests].sort((first, second) => first.requestedAt.getTime() - second.requestedAt.getTime() || first.shipId.localeCompare(second.shipId));
  for (const request of oldestFirst) {
    const read = parsed(request.settings);
    const fitted =
      'settings' in read
        ? fit(read.settings, {
            enabledModels,
            trierarchs: trierarchs.map((trierarch) => ({ ...trierarch, assigned: assigned.get(trierarch.shipId) ?? trierarch.assigned })),
            givenBack: request.givenBack,
          })
        : read;
    if ('trierarch' in fitted) {
      assigned.set(fitted.trierarch.shipId, (assigned.get(fitted.trierarch.shipId) ?? 0) + 1);
      placements.push({ kind: 'assign', shipId: request.shipId, trierarchShipId: fitted.trierarch.shipId });
    } else if (fitted.reason !== request.reason) {
      placements.push({ kind: 'explain', shipId: request.shipId, reason: fitted.reason });
    }
  }
  return placements;
}
