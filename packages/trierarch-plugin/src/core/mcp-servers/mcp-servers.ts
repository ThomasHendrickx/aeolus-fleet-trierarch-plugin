/**
 * The crew-time MCP servers (decisions M2 and M7 of the crew-time MCP servers
 * design): the one list, in the trierarch plugin's configuration, of the
 * remote servers (Streamable HTTP) a session may be crewed with, each by name
 * with its URL and the tools a session may call. It is true across all
 * trierarchs. It holds no credential: a URL has no user, query or fragment.
 */
import { PAYLOAD_MAX_BYTES, payloadBytes, trierarchNameSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';

/** The list as read: by name, each URL one a session may reach and each with the tools it may call. Built only by `readMcpServers`. */
export interface McpServers {
  readonly servers: readonly { readonly name: string; readonly url: string; readonly tools: readonly string[] }[];
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

const serverSchema = z.strictObject({
  url: z.string().refine(isCredentialFree, { error: URL_REFUSED }),
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
  const servers: { name: string; url: string; tools: string[] }[] = [];
  for (const [name, server] of Object.entries(object.data)) {
    const named = trierarchNameSchema.safeParse(name);
    if (!named.success) {
      return err({ reason: `${name}: ${named.error.issues[0]?.message ?? 'not a name'}` });
    }
    const read = serverSchema.safeParse(server);
    if (!read.success) {
      return err({ reason: `${name}: ${read.error.issues[0]?.message ?? 'not a server'}` });
    }
    servers.push({ name, url: read.data.url, tools: read.data.tools });
  }
  servers.sort((first, second) => first.name.localeCompare(second.name));
  const list: McpServers = { servers };
  if (payloadBytes(mcpServersPayload(list)) > PAYLOAD_MAX_BYTES) {
    return err({ reason: `the MCP servers do not fit one message of ${String(PAYLOAD_MAX_BYTES / BYTES_PER_KB)} KB` });
  }
  return ok(list);
}

/** The list as a trierarch receives it: `{ "servers": [{ "name", "url", "tools" }] }`. */
export function mcpServersPayload(list: McpServers): string {
  return JSON.stringify({ servers: list.servers });
}
