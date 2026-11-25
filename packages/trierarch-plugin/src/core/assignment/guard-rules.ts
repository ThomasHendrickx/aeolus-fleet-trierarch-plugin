/** Resolved rules carried to the trierarch before it claims a crew request. */
import type { FleetId, ShipId, TrierarchGuardRulesMessage } from '@aeolus-fleet/common';

import type { GuardRuleDefinition } from '../guard/ports.js';
import { err, ok, type Result } from '../shared/result.js';

export type ResolvedGuardSet = Readonly<TrierarchGuardRulesMessage['sets'][number]>;

export interface AssignmentGuard {
  readonly floor: readonly string[];
  readonly definitions: readonly GuardRuleDefinition[];
  readonly isReadFailed: boolean;
}

export type ReadAssignmentGuard = (fleetId: FleetId) => Promise<AssignmentGuard>;

export interface GuardRequestVersion {
  readonly shipId: ShipId;
  readonly settingsVersion: number;
}

export interface GuardAssignments {
  readPinnedFor(fleetId: FleetId, requests: readonly GuardRequestVersion[]): Promise<ReadonlyMap<ShipId, readonly ResolvedGuardSet[]>>;
  /** Returns the first resolution stored for the ship and version, including an empty one. */
  pin(fleetId: FleetId, request: GuardRequestVersion & { readonly sets: readonly ResolvedGuardSet[] }): Promise<readonly ResolvedGuardSet[]>;
  /** Returns the durable send key for the target, including after an unanswered send. */
  attempt(fleetId: FleetId, target: GuardRequestVersion & { readonly trierarchShipId: ShipId; readonly idempotencyKey: string }): Promise<string>;
}

const MAX_RULE_SETS_BYTES = 64 * 1024;

export function resolveGuardSets({ floor, definitions }: AssignmentGuard, selected: string | undefined): Result<readonly ResolvedGuardSet[], string> {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const selectedSet = selected === undefined ? undefined : byName.get(selected);
  if (selected !== undefined && selectedSet === undefined) {
    return err(`rule set unknown: ${selected}`);
  }

  const sets: ResolvedGuardSet[] = [];
  for (const name of floor) {
    const definition = byName.get(name);
    if (definition === undefined) {
      return err(`floor unavailable: ${name}`);
    }
    sets.push({ ...definition, floor: true });
  }
  if (selectedSet !== undefined && !floor.includes(selectedSet.name)) {
    sets.push({ ...selectedSet, floor: false });
  }
  return ok(sets);
}

export function areGuardSetsWithinLimit(sets: readonly ResolvedGuardSet[]): boolean {
  // The trierarch measures the encoded array after Go's JSON encoder escapes these characters.
  const encoded = JSON.stringify(sets).replace(/[<>&\u2028\u2029]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return Buffer.byteLength(encoded, 'utf8') <= MAX_RULE_SETS_BYTES;
}
