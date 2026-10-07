import { crewSettingsSchema, type CrewSettings, type ShipId, type TrierarchReportDetails } from '@aeolus-fleet/common';
import { z } from 'zod';

/** An unassigned crew request whose ship awaits crew: its settings as the fleet holds them, and the reason written on it now. */
export interface PlacementRequest {
  shipId: ShipId;
  requestedAt: Date;
  /** Unread: placement parses them as crew settings. */
  settings: unknown;
  reason: string | null;
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

/** Why the harness's options schema refuses the options, or undefined when it takes them. A schema it cannot read refuses them all. */
function optionsRefusal(schema: TrierarchReportDetails['harnesses'][number]['options'], options: CrewSettings['options']): string | undefined {
  let checked: z.ZodType;
  try {
    checked = z.fromJSONSchema(schema);
  } catch {
    return 'options: the trierarch reports an options schema that cannot be read';
  }
  const result = checked.safeParse(options);
  const [issue] = result.success ? [] : result.error.issues;
  return issue === undefined ? undefined : lineOf(issue, ['options']);
}

function offersWorkspace(details: TrierarchReportDetails, workspace: CrewSettings['workspace']): boolean {
  return workspace.kind === 'worktree' ? details.workspaces.repositories.includes(workspace.repository) : details.workspaces.folders.includes(workspace.name);
}

function workspaceName(workspace: CrewSettings['workspace']): string {
  return workspace.kind === 'worktree' ? `repository ${workspace.repository}` : `folder ${workspace.name}`;
}

/** Room left as a share of its cap: what placement compares. */
function roomShare(trierarch: PlacementTrierarch): number {
  return (trierarch.details.caps.ships - trierarch.assigned) / trierarch.details.caps.ships;
}

/** The trierarch to claim for the settings, or why none fits: machine labels, harness, workspace, options, then room. */
function fit(settings: CrewSettings, trierarchs: readonly PlacementTrierarch[]): { trierarch: PlacementTrierarch } | Misfit {
  if (trierarchs.length === 0) {
    return { reason: 'no trierarch reports yet' };
  }
  const machineLabels = settings.machineLabels ?? [];
  const matching = trierarchs.filter((trierarch) => machineLabels.every((valueId) => trierarch.labelValueIds.includes(valueId)));
  if (matching.length === 0) {
    // Allowed, not refused (#102, Q8): the request waits until a machine carries them all.
    return { reason: 'no machine matches its labels' };
  }
  const offering = matching.flatMap((trierarch) => {
    const harness = trierarch.details.harnesses.find((each) => each.harness === settings.harness);
    return harness === undefined ? [] : [{ trierarch, harness }];
  });
  if (offering.length === 0) {
    return { reason: `no trierarch offers harness ${settings.harness}`, field: 'harness' };
  }
  const withWorkspace = offering.filter(({ trierarch }) => offersWorkspace(trierarch.details, settings.workspace));
  if (withWorkspace.length === 0) {
    return { reason: `no trierarch offering ${settings.harness} has ${workspaceName(settings.workspace)}`, field: 'workspace' };
  }
  const refusals = withWorkspace.map(({ trierarch, harness }) => ({ trierarch, refusal: optionsRefusal(harness.options, settings.options) }));
  const taking = refusals.filter(({ refusal }) => refusal === undefined).map(({ trierarch }) => trierarch);
  const [firstRefusal] = refusals;
  if (taking.length === 0) {
    return { reason: `no trierarch takes these options for ${settings.harness}: ${firstRefusal?.refusal ?? ''}`, field: 'options' };
  }
  const [best] = taking
    .filter((trierarch) => trierarch.assigned < trierarch.details.caps.ships)
    .sort((first, second) => roomShare(second) - roomShare(first) || first.commissionedAt.getTime() - second.commissionedAt.getTime() || first.shipId.localeCompare(second.shipId));
  return best === undefined ? { reason: `no trierarch with room: all ${String(taking.length)} that fit are full` } : { trierarch: best };
}

/** The settings as crew settings, or why not: the first issue, with the field it is in. */
function parsed(settings: unknown): { settings: CrewSettings } | Misfit {
  const result = crewSettingsSchema.safeParse(settings);
  if (result.success) {
    return { settings: result.data };
  }
  const [issue] = result.error.issues;
  return { reason: `settings are not valid crew settings: ${issue === undefined ? 'unreadable' : lineOf(issue)}`, field: issue?.path[0] === undefined ? 'settings' : String(issue.path[0]) };
}

/**
 * Policy: whether settings would be placed now, before anything is requested
 * (#245): by the same rules as placement, against the trierarchs as they are.
 */
export function checkPlacement(settings: unknown, trierarchs: readonly PlacementTrierarch[]): PlacementCheck {
  const read = parsed(settings);
  const fitted = 'settings' in read ? fit(read.settings, trierarchs) : read;
  if ('trierarch' in fitted) {
    return { kind: 'fits' };
  }
  return fitted.field === undefined ? { kind: 'noRoom', reason: fitted.reason } : { kind: 'refused', field: fitted.field, reason: fitted.reason };
}

/**
 * Policy: where each unassigned request goes (docs/trierarch.md,
 * "Assignment"). Oldest request first, each to a trierarch whose ship
 * carries every machine label it names, that offers its harness and workspace, takes its options against the schema it reports for
 * that harness, and has room (its cap above the requests assigned to it);
 * of those, the most room as a share of its cap, then the oldest. What it
 * assigns counts against the room of later requests in the same pass. A
 * request none fits gets the reason, unless that reason is written already.
 */
export function place(requests: readonly PlacementRequest[], trierarchs: readonly PlacementTrierarch[]): Placement[] {
  const assigned = new Map(trierarchs.map((trierarch) => [trierarch.shipId, trierarch.assigned]));
  const placements: Placement[] = [];
  const oldestFirst = [...requests].sort((first, second) => first.requestedAt.getTime() - second.requestedAt.getTime() || first.shipId.localeCompare(second.shipId));
  for (const request of oldestFirst) {
    const read = parsed(request.settings);
    const fitted =
      'settings' in read
        ? fit(
            read.settings,
            trierarchs.map((trierarch) => ({ ...trierarch, assigned: assigned.get(trierarch.shipId) ?? trierarch.assigned })),
          )
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
