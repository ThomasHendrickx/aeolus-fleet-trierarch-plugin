import { TRIERARCH_GUARD_RULES_CONTENT_TYPE, readCrewSettings, type FleetId, type ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal } from '../connection/ports.js';
import type { McpConfigurations, McpDeliveries } from '../mcp-configuration/ports.js';
import type { IdempotencyKeys } from '../machines/ports.js';
import type { EnabledModels } from '../models/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { GuardAssignments, ReadAssignmentGuard, ResolvedGuardSet } from './ports.js';
import { resolveGuardSets, type GuardResolutionError } from './resolve-guard-sets.js';
import { place } from './placement.js';
import { readPlacement } from './read-placement.js';

/** What a pass did: the claims it won, the reasons it wrote, and the claims another assigner or a change won first. */
export interface AssignOutcome {
  assigned: number;
  explained: number;
  lost: number;
}

export type AssignCrews = (fleetId: FleetId) => Promise<Result<AssignOutcome, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The refusals that mean the request changed since it was read (claimed, crewed or removed): read again on the next pass. */
const CHANGED = new Set(['CONFLICT', 'NOT_FOUND']);

/**
 * Use case: one pass of assignment for a fleet (docs/trierarch.md,
 * "Assignment"). It reads the fleet whole each time: the unassigned requests
 * of ships that await crew, and the trierarchs that report details and are
 * not silent, with the requests assigned to each, and the fleet's enabled
 * models as they are now (model governance, M5), and whether each trierarch
 * confirmed the fleet's current MCP configuration. Placement decides; each
 * claim is optimistic, and one the fleet refuses because the request changed
 * is no error: the next pass reads it again. A silent trierarch gets nothing
 * new and keeps what it holds.
 */
export function createAssignCrews(deps: {
  door: FleetDoor;
  connections: ConnectionStore;
  models: EnabledModels;
  configurations: McpConfigurations;
  deliveries: McpDeliveries;
  clock: Clock;
  guardAssignments: GuardAssignments;
  readGuard: ReadAssignmentGuard;
  keys: IdempotencyKeys;
  silentAfterMs: number;
}): AssignCrews {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer the assignment: ${refusal.message}`);
  return async (fleetId) => {
    const crew = await deps.connections.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'The trierarch plugin is not connected to this fleet: connect it in the console');
    }
    const [{ version }, deliveries] = await Promise.all([deps.configurations.read(fleetId), deps.deliveries.list(fleetId)]);
    const read = await readPlacement(deps.door, { crewToken: crew.crewToken, now: deps.clock.now(), silentAfterMs: deps.silentAfterMs, mcp: { version, deliveries } });
    if (!read.isOk) {
      return unavailable(read.error);
    }
    const { requests, trierarchs } = read.value;
    const [enabledModels, pinned] = await Promise.all([
      deps.models.list(fleetId),
      deps.guardAssignments.readPinnedFor(fleetId, requests),
    ]);
    let catalogue: ReturnType<ReadAssignmentGuard> | undefined;
    const guardSelections = new Map<ShipId, Result<readonly ResolvedGuardSet[], GuardResolutionError>>();
    const byShip = new Map(requests.map((request) => [request.shipId, request]));
    for (const request of requests) {
      const stored = pinned.get(request.shipId);
      if (stored !== undefined) {
        guardSelections.set(request.shipId, ok(stored));
        continue;
      }
      const settings = readCrewSettings(request.settings);
      if ('settings' in settings) {
        catalogue ??= deps.readGuard(fleetId);
        guardSelections.set(request.shipId, resolveGuardSets(await catalogue, settings.settings.ruleSet));
      }
    }

    const outcome: AssignOutcome = { assigned: 0, explained: 0, lost: 0 };
    for (const placement of place(requests, { trierarchs, enabledModels, guardSelections })) {
      if (placement.kind === 'explain') {
        const done = await deps.door.explainCrewRequest(crew.crewToken, { shipId: placement.shipId, reason: placement.reason });
        if (!done.isOk && !CHANGED.has(done.error.code)) {
          return unavailable(done.error);
        }
        outcome.explained += done.isOk ? 1 : 0;
        continue;
      }
      const request = byShip.get(placement.shipId);
      const selection = guardSelections.get(placement.shipId);
      if (request === undefined || !selection?.isOk) {
        continue;
      }
      const { shipId, settingsVersion } = request;
      const sets = pinned.get(shipId) ?? await deps.guardAssignments.pin(fleetId, { shipId, settingsVersion, sets: selection.value });
      if (sets.length > 0 && selection.value.length === 0) {
        // A concurrent pass pinned rules after this pass picked an unguarded target.
        // Read that pin and make the placement again on the next pass.
        continue;
      }
      const { trierarchShipId } = placement;
      const idempotencyKey = await deps.guardAssignments.attempt(fleetId, { shipId, settingsVersion, trierarchShipId, idempotencyKey: deps.keys.next() });
      const sent = await deps.door.send(crew.crewToken, {
        shipId: trierarchShipId,
        contentType: TRIERARCH_GUARD_RULES_CONTENT_TYPE,
        payload: JSON.stringify({ fleetId, pluginShipId: crew.shipId, shipId, settingsVersion, sets }),
        idempotencyKey,
      });
      if (!sent.isOk) {
        return unavailable(sent.error);
      }
      // The claim names the settings version this pass read, so core refuses it if the request changed since (aeolus-fleet #2084).
      const done = await deps.door.assignCrew(crew.crewToken, { shipId, trierarchShipId, settingsVersion });
      if (!done.isOk && !CHANGED.has(done.error.code)) {
        return unavailable(done.error);
      }
      if (done.isOk) {
        outcome.assigned += 1;
      } else {
        outcome.lost += 1;
      }
    }
    return ok(outcome);
  };
}
