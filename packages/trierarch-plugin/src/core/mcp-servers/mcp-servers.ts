/**
 * The crew-time MCP servers (decisions M2 and M7 of the crew-time MCP servers
 * design): the one list, in the trierarch plugin's configuration, of the
 * remote servers (Streamable HTTP) a session may be crewed with, each by name
 * with its URL and the tools a session may call. It is true across all
 * trierarchs. It holds no credential: a URL has no user, query or fragment.
 * A server that needs one names it (decision M6): a secret of the store by
 * name and the HTTP header the trierarch's proxy sets to its value verbatim.
 * The AIP (aeolus-fleet-trierarch-plugin#63) rides with the list: its server
 * URL and the secret that holds its token, by name.
 */
import { PAYLOAD_MAX_BYTES, payloadBytes, trierarchNameSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';

/** What the trierarch's proxy adds to what it forwards to a server: the header, set to the named secret's value verbatim. */
export interface McpCredential {
  readonly secret: string;
  readonly header: string;
}

/** A server on the list, with its credential when it needs one. */
export interface McpServer {
  readonly name: string;
  readonly url: string;
  readonly tools: readonly string[];
  readonly credential?: McpCredential;
}

/** The AIP every trierarch is sent: its server, and the secret of the store that holds its token, by name. */
export interface Aip {
  readonly server: string;
  readonly tokenSecret: string;
}

/** The list as read: by name, each URL one a session may reach and each with the tools it may call. Built only by `readMcpServers`. */
export interface McpServers {
  readonly servers: readonly McpServer[];
  readonly aip?: Aip;
}

/** The content type of the message that carries the list to a trierarch. */
export const MCP_SERVERS_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-servers+json';

/** The content type of the message a trierarch asks for the list again with, as it starts knowing the trierarch plugin's ship. */
export const MCP_SERVERS_REQUEST_CONTENT_TYPE = 'application/vnd.aeolus.trierarch.mcp-servers-request+json';

const BYTES_PER_KB = 1024;

const URL_REFUSED = 'an MCP server is an http:// or https:// URL with no user, query or fragment, never a credential';

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

const credentialSchema = z.strictObject({
  secret: trierarchNameSchema,
  header: z.string().refine(isCredentialHeader, { error: 'a credential header is an HTTP field name the proxy does not set itself' }),
});

const serverSchema = z.strictObject({
  url: z.string().refine(isCredentialFree, { error: URL_REFUSED }),
  credential: credentialSchema.optional(),
  tools: z
    .array(z.string().min(1, { error: 'a tool has a name' }))
    .min(1, { error: 'a server lists the tools a session may call' })
    .refine((tools) => new Set(tools).size === tools.length, { error: 'a tool is listed once' }),
});

const listedSchema = z.record(z.string(), z.unknown());

/**
 * The list from the configuration's object of names to `{ url, tools }`, or
 * why not: each name a trierarch name, each server a credential-free URL with
 * at least one tool, and the whole small enough to reach a trierarch in one
 * message.
 */
export function readMcpServers(listed: unknown): Result<McpServers, { reason: string }> {
  const object = listedSchema.safeParse(listed);
  if (!object.success || Array.isArray(listed)) {
    return err({ reason: 'the MCP servers are an object of names to { url, tools }' });
  }
  const servers: McpServer[] = [];
  for (const [name, server] of Object.entries(object.data)) {
    const named = trierarchNameSchema.safeParse(name);
    if (!named.success) {
      return err({ reason: `${name}: ${named.error.issues[0]?.message ?? 'not a name'}` });
    }
    const read = serverSchema.safeParse(server);
    if (!read.success) {
      return err({ reason: `${name}: ${read.error.issues[0]?.message ?? 'not a server'}` });
    }
    const { url, tools, credential } = read.data;
    servers.push(credential === undefined ? { name, url, tools } : { name, url, tools, credential: { secret: credential.secret, header: credential.header } });
  }
  servers.sort((first, second) => first.name.localeCompare(second.name));
  const list: McpServers = { servers };
  if (payloadBytes(mcpServersPayload(list)) > PAYLOAD_MAX_BYTES) {
    return err({ reason: `the MCP servers do not fit one message of ${String(PAYLOAD_MAX_BYTES / BYTES_PER_KB)} KB` });
  }
  return ok(list);
}

const aipSchema = z.strictObject({
  server: z.string().refine(isCredentialFree, { error: URL_REFUSED }),
  tokenSecret: trierarchNameSchema,
});

/**
 * The list carrying the AIP from the configuration's `{ server, tokenSecret }`,
 * or why not. The reason never holds a value it was given: a field is told by
 * its name.
 */
export function withAip(list: McpServers, listed: unknown): Result<McpServers, { reason: string }> {
  const read = aipSchema.safeParse(listed);
  if (!read.success) {
    const field = read.error.issues[0]?.path[0];
    return err({ reason: `the AIP: ${typeof field === 'string' ? `${field} is missing or not valid` : 'is { server, tokenSecret }'}` });
  }
  const carrying: McpServers = { ...list, aip: { server: read.data.server, tokenSecret: read.data.tokenSecret } };
  if (payloadBytes(mcpServersPayload(carrying)) > PAYLOAD_MAX_BYTES) {
    return err({ reason: `the AIP and the MCP servers do not fit one message of ${String(PAYLOAD_MAX_BYTES / BYTES_PER_KB)} KB` });
  }
  return ok(carrying);
}

/** The one transport a server on the list speaks (decision M8), named in each server of the payload. */
const TRANSPORT = 'streamable-http';

/** The list as a trierarch receives it: `{ "servers": [{ "name", "url", "transport", "tools", "credential"? }], "aip"?: { "server", "tokenSecret" } }`. */
export function mcpServersPayload(list: McpServers): string {
  return JSON.stringify({
    servers: list.servers.map(({ name, url, tools, credential }) => ({ name, url, transport: TRANSPORT, tools, ...(credential && { credential }) })),
    ...(list.aip && { aip: { server: list.aip.server, tokenSecret: list.aip.tokenSecret } }),
  });
}
