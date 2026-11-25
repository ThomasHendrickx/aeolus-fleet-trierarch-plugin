/** Boundaries for resolving and pinning guard rules for assignment. */
import type { FleetId, ShipId, TrierarchGuardRulesMessage } from '@aeolus-fleet/common';

import type { GuardRuleDefinition } from '../guard/ports.js';

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

