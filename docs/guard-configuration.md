# Guard configuration

Each fleet has one guard configuration, initially version 0 with no repositories or floor. A whole replacement advances its version by one. Concurrent writers of the same expected version cannot both save. Repository tokens are service-readable credentials stored and protected as MCP secrets are, including database access and backups. They are write-only at the API and never sent to a trierarch.

## Console API

The plugin's tRPC router authenticates the forwarded console session and uses its fleet. `GET /trpc/guard.get` requires `fleet:read` and answers the tRPC envelope `{ result: { data } }`, where `data` is exactly:

```typescript
{
  version: number;
  repositories: { repository: string; folder: string; access: 'public' | 'private' }[];
  sets: { name: string; repository: string; commit: string; file: string }[];
  errors: { repository: string; file?: string; reason: string }[];
  conflicts: { name: string; repositories: string[] }[];
  floor: string[];
}
```

Only valid, non-conflicting sets are offered. The floor retains configured names even when unavailable. Repository errors omit `file`. No answer includes tokens, credentials or rules. The console forwards this through `GET /api/trierarch-plugin/guard.get`.

`POST /trpc/guard.replace` requires `trierarch:guard` and the console's forwarded Origin. Its input follows MCP replacement field names:

```typescript
{
  expectedVersion: number;
  repositories: { repository: string; folder: string; access: 'public' | 'private' }[];
  floor: string[];
  secrets: string[];
  secretValues: Record<string, string>;
}
```

`repository` is `owner/name`. Each private repository appears in `secrets` under that repository name. `secretValues` supplies its initial or replacement read token; omitting the value retains the stored token. A private repository without either is refused. A public or removed repository retains no token. Success answers `{ version }`; a stale version is a conflict. A successful replacement triggers a repository read.

## Repository refresh

On replacement and every five minutes, GitHub supplies each repository's default-branch commit. An unchanged commit needs no tree or blob reads. A changed commit supplies its tree, and only changed `.yaml` blobs in the configured folder are downloaded. Complete snapshots survive restart. Invalid files are errors, conflicting names are not offered, and a failed repository read keeps the last complete snapshot with a safe public error.

Catalogue reads use a per-fleet cache with a five-minute staleness bound and invalidate on configuration version change. Refreshes and replacements are serialized per fleet in the process; the database guards configuration replacement across processes. Repository reads run concurrently across repositories. This configuration path scales with configured repositories and rule files, independently of fleet ship and message counts.
