/** Boundaries for the fleet's guard catalogue. Credentials stay behind the source port. */
import type { FleetId, GuardRules } from '@aeolus-fleet/common';

import type { StoredGuardConfiguration } from './guard-configuration.js';
import type { Result } from '../shared/result.js';

export interface GuardRepository {
  readonly repository: string;
  readonly folder: string;
  readonly access: 'public' | 'private';
}

export interface GuardConfiguration {
  readonly version: number;
  readonly repositories: readonly GuardRepository[];
  readonly floor: readonly string[];
}

/** Validated by the shared common schema at the boundary, never an unvalidated YAML object. */
export interface GuardDefinition {
  readonly name: string;
  readonly rules: Readonly<GuardRules>;
}

export interface GuardFile {
  readonly file: string;
  readonly blob: string;
}

export interface GuardReadFile extends GuardFile {
  readonly result: Result<GuardDefinition, string>;
}

/** Last complete read, including invalid files so unchanged invalid blobs need no download. */
export interface GuardSnapshot {
  readonly repository: string;
  readonly folder: string;
  readonly commit: string;
  readonly files: readonly GuardReadFile[];
}

export interface GuardSnapshots {
  read(fleetId: FleetId, repository: GuardRepository): Promise<GuardSnapshot | undefined>;
  save(fleetId: FleetId, snapshot: GuardSnapshot): Promise<void>;
  fail(fleetId: FleetId, input: { repository: GuardRepository; reason: string }): Promise<void>;
  readFailure(fleetId: FleetId, repository: GuardRepository): Promise<{ reason: string; at: Date } | undefined>;
}

/**
 * Reads the default branch head, then the configured folder at that exact commit.
 * Tree entries are repository-relative paths. All error strings are safe public
 * reasons: never an upstream response, credential, URL containing a token, or rules.
 * A read refusal means the repository read failed, not an invalid rule file.
 */
export interface GuardSource {
  latest(fleetId: FleetId, repository: GuardRepository): Promise<Result<string, string>>;
  tree(fleetId: FleetId, input: { repository: GuardRepository; commit: string }): Promise<Result<readonly GuardFile[], string>>;
  read(fleetId: FleetId, input: { repository: GuardRepository; commit: string; file: string; blob: string }): Promise<Result<string, string>>;
}

/** Parses YAML and validates against common's shared guard schema. Reasons contain no file content. */
export interface GuardValidation {
  read(content: string): Result<GuardDefinition, string>;
}

export interface GuardSet {
  readonly name: string;
  readonly repository: string;
  readonly commit: string;
  readonly file: string;
}

export interface GuardRuleDefinition extends GuardSet {
  readonly rules: GuardDefinition['rules'];
}

export interface GuardCatalogueRead {
  readonly catalogue: GuardCatalogue;
  readonly definitions: readonly GuardRuleDefinition[];
  readonly isReadFailed: boolean;
}

export interface GuardError {
  readonly repository: string;
  readonly file?: string;
  readonly reason: string;
}

/** Exactly the data guard.get exposes, without rule definitions or credentials. */
export interface GuardCatalogue extends Omit<GuardConfiguration, 'repositories'> {
  readonly repositories: readonly (GuardRepository & { readonly readCommit: string | null })[];
  readonly sets: readonly (GuardSet & { readonly rulesCount: number })[];
  readonly errors: readonly GuardError[];
  readonly conflicts: readonly { readonly name: string; readonly repositories: readonly string[] }[];
}

/** The credential store, readable only to the service. A replacement and its tokens commit together. */
export interface GuardConfigurations {
  readConfiguration(fleetId: FleetId): Promise<StoredGuardConfiguration>;
  replace(fleetId: FleetId, input: { expectedVersion: number; configuration: StoredGuardConfiguration }): Promise<'replaced' | 'conflict'>;
}
