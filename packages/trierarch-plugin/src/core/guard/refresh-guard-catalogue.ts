/** Refreshes only changed YAML blobs, keeping a complete prior read when the repository cannot be read. */
import type { FleetId } from '@aeolus-fleet/common';

import { err, ok, type Result } from '../shared/result.js';
import { guardCatalogue } from './guard-catalogue.js';
import type { GuardCatalogueRead, GuardConfiguration, GuardDefinition, GuardError, GuardReadFile, GuardRepository, GuardSnapshot, GuardSnapshots, GuardSource, GuardValidation } from './ports.js';

const FILE_MAX_BYTES = 64 * 1024;

interface Dependencies {
  readonly source: GuardSource;
  readonly validation: GuardValidation;
  readonly snapshots: GuardSnapshots;
}

function validateFile(validation: GuardValidation, input: { file: string; content: string }): Result<GuardDefinition, string> {
  if (Buffer.byteLength(input.content, 'utf8') > FILE_MAX_BYTES) {
    return err('rule set exceeds 64 KB');
  }
  const result = validation.read(input.content);
  if (!result.isOk) {
    return result;
  }
  const name = input.file.split('/').at(-1)?.slice(0, -'.yaml'.length);
  return result.value.name === name ? result : err('rule set name does not match file name');
}

async function readRepository(deps: Dependencies, input: { fleetId: FleetId; repository: GuardRepository; previous: GuardSnapshot | undefined }): Promise<Result<GuardSnapshot, string>> {
  const { fleetId, repository, previous } = input;
  const latest = await deps.source.latest(fleetId, repository);
  if (!latest.isOk) {
    return latest;
  }
  if (previous?.commit === latest.value) {
    return ok(previous);
  }
  const tree = await deps.source.tree(fleetId, { repository, commit: latest.value });
  if (!tree.isOk) {
    return tree;
  }
  const files: GuardReadFile[] = [];
  for (const file of tree.value.filter(({ file }) => file.endsWith('.yaml'))) {
    const cached = previous?.files.find((old) => old.file === file.file && old.blob === file.blob);
    if (cached !== undefined) {
      files.push(cached);
      continue;
    }
    const read = await deps.source.read(fleetId, { repository, commit: latest.value, ...file });
    if (!read.isOk) {
      return read;
    }
    files.push({ ...file, result: validateFile(deps.validation, { file: file.file, content: read.value }) });
  }
  return ok({ repository: repository.repository, folder: repository.folder, commit: latest.value, files });
}

/**
 * One update, called for newly added repositories and on operator request.
 * Independent repositories read concurrently. Snapshots are scoped to fleet,
 * repository and folder; a failed refresh never replaces the last complete read.
 */
export function createRefreshGuardCatalogue(deps: Dependencies): (fleetId: FleetId, configuration: GuardConfiguration) => Promise<GuardCatalogueRead> {
  return async (fleetId, configuration) => {
    const reads = await Promise.all(configuration.repositories.map(async (repository) => {
      const previous = await deps.snapshots.read(fleetId, repository);
      const read = await readRepository(deps, { fleetId, repository, previous });
      if (!read.isOk) {
        return { snapshot: previous, error: { repository: repository.repository, reason: read.error } };
      }
      if (read.value !== previous) {
        await deps.snapshots.save(fleetId, read.value);
      }
      return { snapshot: read.value, error: undefined };
    }));
    const snapshots: GuardSnapshot[] = [];
    const errors: GuardError[] = [];
    for (const read of reads) {
      if (read.snapshot !== undefined) {
        snapshots.push(read.snapshot);
      }
      if (read.error !== undefined) {
        errors.push(read.error);
      }
    }
    return guardCatalogue({ configuration, snapshots, errors });
  };
}

/** Reads only the persisted snapshots, without contacting the source. */
export function createReadGuardCatalogue(snapshots: GuardSnapshots): (fleetId: FleetId, configuration: GuardConfiguration) => Promise<GuardCatalogueRead> {
  return async (fleetId, configuration) => {
    const reads = await Promise.all(configuration.repositories.map((repository) => snapshots.read(fleetId, repository)));
    return guardCatalogue({ configuration, snapshots: reads.filter((snapshot) => snapshot !== undefined), errors: [] });
  };
}
