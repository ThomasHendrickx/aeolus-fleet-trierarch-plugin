import type { FleetId, PluginCallContext } from '@aeolus-fleet/common';

import { REPOSITORIES_SCOPE } from '../scopes/plugin-scopes.js';
import { err, ok, type Result } from '../shared/result.js';
import { changeRepositoryList, type RepositoryList } from './repository-list.js';

type ActorContext = Pick<PluginCallContext, 'fleetId' | 'actor' | 'requestId' | 'scopes'>;
type Change = { readonly kind: 'add'; readonly name: string; readonly url: string; readonly expectedVersion: number } | { readonly kind: 'remove'; readonly name: string; readonly expectedVersion: number };
interface Event { actor: PluginCallContext['actor']; operation: Change['kind']; name: string; version: number; requestId: string }
interface Refusal { reason: string }

export interface RepositoryStore {
  read(fleetId: FleetId): Promise<RepositoryList>;
  save(fleetId: FleetId, change: { expectedVersion: number; next: RepositoryList; event: Event }): Promise<boolean>;
}

/** Applies scope and optimistic version checks to each verified dispatch. */
export function createManageRepositories(store: RepositoryStore) {
  return {
    list: async (context: ActorContext): Promise<Result<RepositoryList, Refusal>> => {
      if (!context.scopes.includes(REPOSITORIES_SCOPE)) return err({ reason: 'forbidden' });
      return ok(await store.read(context.fleetId));
    },
    change: async (context: ActorContext, change: Change): Promise<Result<RepositoryList, Refusal>> => {
      if (!context.scopes.includes(REPOSITORIES_SCOPE)) return err({ reason: 'forbidden' });
      const current = await store.read(context.fleetId);
      const changed = changeRepositoryList(current, change);
      if (!changed.isOk || changed.value.version === current.version) return changed;
      const isSaved = await store.save(context.fleetId, { expectedVersion: current.version, next: changed.value, event: { actor: context.actor, operation: change.kind, name: change.name, version: changed.value.version, requestId: context.requestId } });
      return isSaved ? changed : err({ reason: 'version conflict' });
    },
  };
}
