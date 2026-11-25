import { err, ok, type Result } from '../shared/result.js';
import type { AssignmentGuard, ResolvedGuardSet } from './ports.js';

export type GuardResolutionError = { readonly kind: 'ruleSetUnknown'; readonly name: string } | { readonly kind: 'floorUnavailable'; readonly name: string };

export function resolveGuardSets({ floor, definitions }: AssignmentGuard, selected: string | undefined): Result<readonly ResolvedGuardSet[], GuardResolutionError> {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const selectedSet = selected === undefined ? undefined : byName.get(selected);
  if (selected !== undefined && selectedSet === undefined) {
    return err({ kind: 'ruleSetUnknown', name: selected });
  }

  const sets: ResolvedGuardSet[] = [];
  for (const name of floor) {
    const definition = byName.get(name);
    if (definition === undefined) {
      return err({ kind: 'floorUnavailable', name });
    }
    sets.push({ ...definition, floor: true });
  }
  if (selectedSet !== undefined && !floor.includes(selectedSet.name)) {
    sets.push({ ...selectedSet, floor: false });
  }
  return ok(sets);
}

