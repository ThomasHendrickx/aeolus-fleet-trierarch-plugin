/**
 * A fleet's MCP configuration (the fleet crew MCP design, section 4): the
 * remote servers (Streamable HTTP) a session of that fleet may be crewed
 * with, each by name with its URL, the tools a session may call and the
 * credential its proxy adds, and the secrets those credentials name, with
 * their values. One current set per fleet, in the trierarch plugin's own
 * database, at a version that moves on by one with every replacement. A
 * replacement is whole: the complete server list, the complete list of the
 * secrets it retains and the values it sets. A value is never shown, logged
 * or told in a reason; it leaves the trierarch plugin only sealed to a
 * trierarch's key, so the set, once sealed, fits one message.
 */
import { PAYLOAD_MAX_BYTES, payloadBytes, trierarchNameSchema, type FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/** What the trierarch's proxy adds to what it forwards to a server: the header, set to the named secret's value verbatim (decision M6). */
export interface McpCredential {
  readonly secret: string;
  readonly header: string;
}

/** A server of the set, with its credential when it needs one. */
export interface McpServer {
  readonly name: string;
  readonly url: string;
  readonly tools: readonly string[];
  readonly credential?: McpCredential;
}

/** A secret of the set, by name, with its value: fit for an HTTP header verbatim. */
export interface McpSecret {
  readonly name: string;
  readonly value: string;
}

/** A fleet's set as saved: its version, its servers and its secrets, each in name order. Built only by `replaceMcpConfiguration`. */
export interface McpConfiguration {
  readonly version: number;
  readonly servers: readonly McpServer[];
  readonly secrets: readonly McpSecret[];
}

/** What `mcp.get` answers: the version, the servers and the secrets by name, never a value. */
export interface McpConfigurationMetadata {
  readonly version: number;
  readonly servers: readonly McpServer[];
  readonly secrets: readonly string[];
}

/** A fleet's set before its first replacement. */
export const EMPTY_MCP_CONFIGURATION: McpConfiguration = { version: 0, servers: [], secrets: [] };

/**
 * A whole replacement as a manager asks it: the version it read, every
 * server, every secret it retains by name, and the new or replacement
 * values, by name, of secrets it retains.
 */
export interface McpReplacement {
  readonly expectedVersion: number;
  readonly servers: readonly { readonly name: string; readonly url: string; readonly tools: readonly string[]; readonly credential?: McpCredential }[];
  readonly secrets: readonly string[];
  readonly secretValues: Readonly<Record<string, string>>;
}

/** What a replacement changed, by name: never a value. */
export interface McpChange {
  readonly servers: readonly string[];
  readonly secrets: readonly string[];
}

/** The content type of the message that carries a fleet's set, whole and sealed, to a trierarch. */
export const MCP_CONFIGURATION_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-configuration+json';

/** The content type of the message a trierarch asks for its fleet's set with. */
export const MCP_CONFIGURATION_REQUEST_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-configuration-request+json';

/** The content type of the message a trierarch confirms with that it applied a version, sealed to a key. */
export const MCP_CONFIGURATION_APPLIED_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-configuration-applied+json';

/** The one transport a server speaks (decision M8), named in each server of the message. */
const TRANSPORT = 'streamable-http';

const BYTES_PER_KB = 1024;

/** The most a value may hold, in bytes of UTF-8, as the trierarch takes it. */
const VALUE_MAX_BYTES = 8192;

/** What a sealed box adds to the value: the ephemeral public key and the tag. */
const SEALED_BOX_OVERHEAD_BYTES = 48;

/** A public key of the sealing scheme, in bytes. */
const PUBLIC_KEY_BYTES = 32;

/** A ship id as the fleet makes one, every id the same length: what the size check counts for the plugin's ship. */
const SHIP_ID_SHAPE = `shp_${'0'.repeat(26)}`;

const URL_REFUSED = 'an MCP server is an http:// or https:// URL with no user, query or fragment, never a credential';

const VALUE_REFUSED = `a value is 1 to ${String(VALUE_MAX_BYTES)} bytes of UTF-8 with no CR, LF or NUL`;

/** Whether the URL is a remote server's, which carries no credential in itself. */
function isCredentialFree(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname !== '' && parsed.username === '' && parsed.password === '' && parsed.search === '' && parsed.hash === '';
}

/** An HTTP field name: an RFC 9110 token. */
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** The headers the proxy itself owns, or that frame the request or its session: never a credential's. */
const HEADERS_REFUSED = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'te', 'trailer', 'keep-alive', 'cookie', 'content-type', 'accept', 'accept-encoding', 'last-event-id', 'mcp-session-id', 'mcp-protocol-version']);

/** Whether a credential may go in the header: a token the proxy does not own. */
function isCredentialHeader(header: string): boolean {
  const lower = header.toLowerCase();
  return HEADER_TOKEN.test(header) && !HEADERS_REFUSED.has(lower) && !lower.startsWith('proxy-');
}

const serverSchema = z.object({
  url: z.string().refine(isCredentialFree, { error: URL_REFUSED }),
  credential: z.object({ secret: trierarchNameSchema, header: z.string().refine(isCredentialHeader, { error: 'a credential header is an HTTP field name the proxy does not set itself' }) }).optional(),
  tools: z
    .array(z.string().min(1, { error: 'a tool has a name' }))
    .min(1, { error: 'a server lists the tools a session may call' })
    .refine((tools) => new Set(tools).size === tools.length, { error: 'a tool is listed once' }),
});

/** Whether the value can go in an HTTP header verbatim and the trierarch takes it. */
function isValue(value: string): boolean {
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= 1 && bytes <= VALUE_MAX_BYTES && !['\r', '\n', '\u0000'].some((refused) => value.includes(refused));
}

/** The length of standard base64 with padding of so many bytes. */
function base64Length(bytes: number): number {
  const BASE64_GROUP_BYTES = 3;
  const BASE64_GROUP_CHARACTERS = 4;
  return Math.ceil(bytes / BASE64_GROUP_BYTES) * BASE64_GROUP_CHARACTERS;
}

const byName = (first: { name: string }, second: { name: string }) => first.name.localeCompare(second.name);

const invalid = (message: string) => refuse('INVALID_CONFIGURATION', message);

/** The servers, read and in name order, or why not: each told by its name, or by its position when its name is not one. */
function readServers(listed: McpReplacement['servers']): Result<McpServer[], DomainError<'INVALID_CONFIGURATION'>> {
  const servers: McpServer[] = [];
  for (const [index, server] of listed.entries()) {
    const named = trierarchNameSchema.safeParse(server.name);
    if (!named.success) {
      return invalid(`server ${String(index + 1)}: ${named.error.issues[0]?.message ?? 'not a name'}`);
    }
    if (servers.some((each) => each.name === server.name)) {
      return invalid(`${server.name}: a server is named once`);
    }
    const read = serverSchema.safeParse(server);
    if (!read.success) {
      return invalid(`${server.name}: ${read.error.issues[0]?.message ?? 'not a server'}`);
    }
    const { url, tools, credential } = read.data;
    servers.push(credential === undefined ? { name: server.name, url, tools } : { name: server.name, url, tools, credential: { secret: credential.secret, header: credential.header } });
  }
  return ok(servers.sort(byName));
}

/**
 * The secrets the replacement retains, each with its new value or the one it
 * holds, in name order, or why not. A name that fails the rules may be a
 * value put in its place, so it is told by position; so is a value's name
 * the retained list does not hold.
 */
function readSecrets(current: McpConfiguration, replacement: McpReplacement): Result<McpSecret[], DomainError<'INVALID_CONFIGURATION'>> {
  const secrets: McpSecret[] = [];
  for (const [index, name] of replacement.secrets.entries()) {
    if (!trierarchNameSchema.safeParse(name).success) {
      return invalid(`secret ${String(index + 1)}: not a name: a secret is named as a server is`);
    }
    if (secrets.some((each) => each.name === name)) {
      return invalid(`${name}: a secret is retained once`);
    }
    const value = Object.hasOwn(replacement.secretValues, name) ? replacement.secretValues[name] : current.secrets.find((each) => each.name === name)?.value;
    if (value === undefined) {
      return invalid(`${name}: a retained secret needs a value until it holds one`);
    }
    if (!isValue(value)) {
      return invalid(`${name}: ${VALUE_REFUSED}`);
    }
    secrets.push({ name, value });
  }
  const unretained = Object.keys(replacement.secretValues).findIndex((name) => !replacement.secrets.includes(name));
  if (unretained !== -1) {
    return invalid(`secret value ${String(unretained + 1)}: names no secret the replacement retains`);
  }
  return ok(secrets.sort(byName));
}

/** The names whose entry the replacement added, removed or changed, in name order. */
function changedNames<T extends { name: string }>({ before, after }: { before: readonly T[]; after: readonly T[] }, isSame: (first: T, second: T) => boolean): string[] {
  const names = new Set([...before, ...after].map((each) => each.name));
  return [...names]
    .filter((name) => {
      const old = before.find((each) => each.name === name);
      const updated = after.find((each) => each.name === name);
      return old === undefined || updated === undefined || !isSame(old, updated);
    })
    .sort((first, second) => first.localeCompare(second));
}

/** The size of the message that carries the set to a trierarch of the fleet once sealed, which a sealed box makes exact. */
function sealedPayloadBytes(fleetId: FleetId, configuration: McpConfiguration): number {
  return payloadBytes(
    mcpConfigurationPayload({
      fleetId,
      pluginShipId: SHIP_ID_SHAPE,
      version: configuration.version,
      publicKey: 'A'.repeat(base64Length(PUBLIC_KEY_BYTES)),
      servers: configuration.servers,
      secrets: configuration.secrets.map(({ name, value }) => ({ name, sealed: 'A'.repeat(base64Length(Buffer.byteLength(value, 'utf8') + SEALED_BOX_OVERHEAD_BYTES)) })),
    }),
  );
}

/**
 * Policy: the fleet's set after a whole replacement, one version on, and what
 * it changed by name; or why not, the whole replacement refused: a version
 * other than the current one, a server or secret that fails the rules, a
 * credential naming a secret it does not retain, a retained secret with
 * neither a value nor one held, a value for a secret it does not retain, or
 * a set too large for one message once sealed. No reason holds a value.
 */
export function replaceMcpConfiguration(
  { fleetId, current }: { fleetId: FleetId; current: McpConfiguration },
  replacement: McpReplacement,
): Result<{ configuration: McpConfiguration; changed: McpChange }, DomainError<'VERSION_CONFLICT' | 'INVALID_CONFIGURATION'>> {
  if (replacement.expectedVersion !== current.version) {
    return refuse('VERSION_CONFLICT', `The MCP configuration is at version ${String(current.version)}, not ${String(replacement.expectedVersion)}: read it again before replacing it`);
  }
  const servers = readServers(replacement.servers);
  if (!servers.isOk) {
    return servers;
  }
  const secrets = readSecrets(current, replacement);
  if (!secrets.isOk) {
    return secrets;
  }
  for (const server of servers.value) {
    if (server.credential !== undefined && !replacement.secrets.includes(server.credential.secret)) {
      return invalid(`${server.name}: its credential names the secret ${server.credential.secret}, which the replacement does not retain`);
    }
  }
  const configuration: McpConfiguration = { version: current.version + 1, servers: servers.value, secrets: secrets.value };
  if (sealedPayloadBytes(fleetId, configuration) > PAYLOAD_MAX_BYTES) {
    return invalid(`the MCP configuration does not fit one message of ${String(PAYLOAD_MAX_BYTES / BYTES_PER_KB)} KB once sealed`);
  }
  return ok({
    configuration,
    changed: {
      servers: changedNames({ before: current.servers, after: configuration.servers }, (first, second) => JSON.stringify(first) === JSON.stringify(second)),
      secrets: changedNames({ before: current.secrets, after: configuration.secrets }, (first, second) => first.value === second.value && !Object.hasOwn(replacement.secretValues, second.name)),
    },
  });
}

/** The set as `mcp.get` shows it: the secrets by name only. */
export function mcpConfigurationMetadata(configuration: McpConfiguration): McpConfigurationMetadata {
  return { version: configuration.version, servers: configuration.servers, secrets: configuration.secrets.map((secret) => secret.name) };
}

/**
 * The set as a trierarch receives it (design section 5): `{ fleetId,
 * pluginShipId, version, publicKey, servers: [{ name, url, transport, tools,
 * credential? }], secrets: [{ name, sealed }] }`, each value sealed to the
 * public key named.
 */
export function mcpConfigurationPayload(message: {
  fleetId: FleetId;
  pluginShipId: string;
  version: number;
  publicKey: string;
  servers: readonly McpServer[];
  secrets: readonly { name: string; sealed: string }[];
}): string {
  return JSON.stringify({
    fleetId: message.fleetId,
    pluginShipId: message.pluginShipId,
    version: message.version,
    publicKey: message.publicKey,
    servers: message.servers.map(({ name, url, tools, credential }) => ({ name, url, transport: TRANSPORT, tools, ...(credential && { credential: { secret: credential.secret, header: credential.header } }) })),
    secrets: message.secrets.map(({ name, sealed }) => ({ name, sealed })),
  });
}
