/** Public projection of complete repository reads: invalid and conflicting names are never offered. */
import type { GuardCatalogue, GuardConfiguration, GuardError, GuardSet, GuardSnapshot } from './ports.js';

export function guardCatalogue(input: { configuration: GuardConfiguration; snapshots: readonly GuardSnapshot[]; errors: readonly GuardError[] }): GuardCatalogue {
  const sets: GuardSet[] = [];
  const errors = [...input.errors];
  for (const snapshot of input.snapshots) {
    const folder = snapshot.folder.replace(/\/$/, '');
    for (const file of snapshot.files) {
      // An existing snapshot can contain files from a recursive tree read.
      const parent = file.file.slice(0, Math.max(0, file.file.lastIndexOf('/')));
      if (parent !== folder) { continue; }
      if (file.result.isOk) {
        sets.push({ name: file.result.value.name, repository: snapshot.repository, commit: snapshot.commit, file: file.file });
      } else {
        errors.push({ repository: snapshot.repository, file: file.file, reason: file.result.error });
      }
    }
  }
  const names = new Map<string, Set<string>>();
  for (const set of sets) {
    const repositories = names.get(set.name) ?? new Set<string>();
    repositories.add(set.repository);
    names.set(set.name, repositories);
  }
  const conflicts = [...names].filter(([, repositories]) => repositories.size > 1).map(([name, repositories]) => ({ name, repositories: [...repositories] }));
  const conflicting = new Set(conflicts.map(({ name }) => name));
  return {
    version: input.configuration.version,
    repositories: input.configuration.repositories.map(({ repository, folder, access }) => ({ repository, folder, access })),
    floor: [...input.configuration.floor],
    sets: sets.filter(({ name }) => !conflicting.has(name)),
    errors,
    conflicts,
  };
}
