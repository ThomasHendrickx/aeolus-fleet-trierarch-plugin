/**
 * The secret store (decision M5 of the crew-time MCP servers design): the
 * credentials the crew-time MCP servers need, by name, in the trierarch
 * plugin's configuration, one store for every fleet and trierarch. A value
 * leaves the trierarch plugin only sealed to a trierarch's own key, so the
 * fleet stores only what it cannot read; the trierarch's proxy puts it in an
 * HTTP header verbatim, so it holds no CR, LF or NUL.
 */
import { PAYLOAD_MAX_BYTES, payloadBytes, trierarchNameSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';
import type { McpServers } from './mcp-servers.js';

/** The store as read: each secret by name with its value, in name order. Built only by `readSecrets`. */
export interface Secrets {
  readonly secrets: readonly { readonly name: string; readonly value: string }[];
}

/** The content type of the message that carries the store, sealed, to a trierarch. */
export const SECRETS_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.secrets+json';

/** The content type of the message a trierarch asks for the store again with, once per process. */
export const SECRETS_REQUEST_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.secrets-request+json';

/** The most a value may hold, in bytes of UTF-8, as the trierarch takes it. */
const VALUE_MAX_BYTES = 8192;

/** What a sealed box adds to the value: the ephemeral public key and the tag. */
const SEALED_BOX_OVERHEAD_BYTES = 48;

/** A public key of the sealing scheme, in bytes. */
const PUBLIC_KEY_BYTES = 32;

const BYTES_PER_KB = 1024;

const VALUE_REFUSED = `a value is 1 to ${String(VALUE_MAX_BYTES)} bytes of UTF-8 with no CR, LF or NUL`;

const listedSchema = z.record(z.string(), z.unknown());

/** Whether the value can go in an HTTP header verbatim and the trierarch takes it. */
function isValue(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= 1 && bytes <= VALUE_MAX_BYTES && !['\r', '\n', '\u0000'].some((refused) => value.includes(refused));
}

/** The length of standard base64 with padding of so many bytes. */
function base64Length(bytes: number): number {
  const BASE64_GROUP_BYTES = 3;
  const BASE64_GROUP_CHARACTERS = 4;
  return Math.ceil(bytes / BASE64_GROUP_BYTES) * BASE64_GROUP_CHARACTERS;
}

/** The size of the message that carries the store once sealed, which a sealed box makes exact. */
function sealedPayloadBytes(store: Secrets): number {
  return payloadBytes(
    secretsPayload({
      publicKey: 'A'.repeat(base64Length(PUBLIC_KEY_BYTES)),
      secrets: store.secrets.map(({ name, value }) => ({ name, sealed: 'A'.repeat(base64Length(Buffer.byteLength(value, 'utf8') + SEALED_BOX_OVERHEAD_BYTES)) })),
    }),
  );
}

/**
 * The store from the configuration's object of names to values, or why not,
 * never naming a value or a name that fails the rules (an entry is told by
 * its position): each name a trierarch name, each value fit for a
 * header, every secret a server's credential names held, and the whole
 * small enough, once sealed, to reach a trierarch in one message.
 */
export function readSecrets(listed: unknown, servers: McpServers): Result<Secrets, { reason: string }> {
  const object = listedSchema.safeParse(listed);
  if (!object.success || Array.isArray(listed)) {
    return err({ reason: 'the secrets are an object of names to values' });
  }
  const secrets: { name: string; value: string }[] = [];
  for (const [index, [name, value]] of Object.entries(object.data).entries()) {
    const named = trierarchNameSchema.safeParse(name);
    if (!named.success) {
      // A name that fails the rules may be a value swapped into its place, so the entry is told by position.
      return err({ reason: `entry ${String(index + 1)}: ${named.error.issues[0]?.message ?? 'not a name'}` });
    }
    if (!isValue(value)) {
      return err({ reason: `${name}: ${VALUE_REFUSED}` });
    }
    secrets.push({ name, value });
  }
  secrets.sort((first, second) => first.name.localeCompare(second.name));
  const names = new Set(secrets.map((secret) => secret.name));
  for (const server of servers.servers) {
    if (server.credential !== undefined && !names.has(server.credential.secret)) {
      return err({ reason: `${server.name}: its credential names the secret ${server.credential.secret}, which the store does not hold` });
    }
  }
  const store: Secrets = { secrets };
  if (sealedPayloadBytes(store) > PAYLOAD_MAX_BYTES) {
    return err({ reason: `the secrets do not fit one message of ${String(PAYLOAD_MAX_BYTES / BYTES_PER_KB)} KB once sealed` });
  }
  return ok(store);
}

/** The store as a trierarch receives it: sealed to the public key named, each value as base64. */
export function secretsPayload(sealed: { publicKey: string; secrets: readonly { name: string; sealed: string }[] }): string {
  return JSON.stringify({ publicKey: sealed.publicKey, secrets: sealed.secrets.map(({ name, sealed: value }) => ({ name, sealed: value })) });
}
