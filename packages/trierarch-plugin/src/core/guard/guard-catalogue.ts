/** Public projection of complete repository reads: invalid and conflicting names are never offered. */
import type { GuardCatalogueRead, GuardConfiguration, GuardError, GuardRuleDefinition, GuardSnapshot } from './ports.js';

export function guardCatalogue(input: { configuration: GuardConfiguration; snapshots: readonly GuardSnapshot[]; errors: readonly GuardError[] }): GuardCatalogueRead {
  const sets: GuardRuleDefinition[] = [];
  const errors = [...input.errors];
  for (const snapshot of input.snapshots) {
    const folder = snapshot.folder.replace(/\/$/, '');
    for (const file of snapshot.files) {
      // An existing snapshot can contain files from a recursive tree read.
      const parent = file.file.slice(0, Math.max(0, file.file.lastIndexOf('/')));
      if (parent !== folder) { continue; }
      if (file.result.isOk) {
        sets.push({ name: file.result.value.name, repository: snapshot.repository, commit: snapshot.commit, file: file.file, rules: file.result.value.rules });
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
  const definitions = sets.filter(({ name }) => !conflicting.has(name));
  return {
    definitions,
    isReadFailed: input.errors.length > 0,
    catalogue: {
      version: input.configuration.version,
      repositories: input.configuration.repositories.map(({ repository, folder, access }) => ({
        repository, folder, access, readCommit: input.snapshots.find((snapshot) => snapshot.repository === repository && snapshot.folder === folder)?.commit ?? null,
      })),
      floor: [...input.configuration.floor],
      sets: definitions.map(({ name, repository, commit, file, rules }) => ({
        name, repository, commit, file,
        rulesCount: (rules.commands?.allow?.length ?? 0) + (rules.commands?.deny?.length ?? 0)
          + (rules.git?.deny?.length ?? 0) + (rules.writePaths?.allow?.length ?? 0)
          + (rules.writePaths?.deny?.length ?? 0) + (rules.tools?.allow?.length ?? 0) + (rules.tools?.deny?.length ?? 0),
      })),
      errors,
      conflicts,
    },
  };
}
