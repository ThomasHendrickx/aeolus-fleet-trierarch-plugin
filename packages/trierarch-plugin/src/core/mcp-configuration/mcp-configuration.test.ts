import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/connection-fakes.js';
import { EMPTY_MCP_CONFIGURATION, mcpConfigurationMetadata, mcpConfigurationPayload, replaceMcpConfiguration, type McpConfiguration, type McpReplacement } from './mcp-configuration.js';

const GRAPH = { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher', 'get_neo4j_schema'] };
const WITH_TOKEN = { ...GRAPH, credential: { secret: 'graph-token', header: 'Authorization' } };
/** A value no real credential looks like, searched for in every refusal. */
const VALUE = 'Bearer test-value-never-told-5d1e';

function aReplacement(change: Partial<McpReplacement> = {}): McpReplacement {
  return { expectedVersion: 0, servers: [], secrets: [], secretValues: {}, ...change };
}

const replace = (replacement: McpReplacement, current: McpConfiguration = EMPTY_MCP_CONFIGURATION) => replaceMcpConfiguration(current, replacement, { fleetId: FLEET_ID });

function saved(replacement: McpReplacement, current?: McpConfiguration): McpConfiguration {
  const replaced = replace(replacement, current);
  expect(replaced.isOk).toBe(true);
  return replaced.isOk ? replaced.value.configuration : EMPTY_MCP_CONFIGURATION;
}

describe("a fleet's MCP configuration", () => {
  it('starts at version 0 with no servers and no secrets', () => {
    expect(mcpConfigurationMetadata(EMPTY_MCP_CONFIGURATION)).toEqual({ version: 0, servers: [], secrets: [] });
  });

  it('replaces the whole set, one version on, servers and secrets in name order', () => {
    const replaced = replace(
      aReplacement({
        servers: [WITH_TOKEN, { name: 'atlas', url: 'http://atlas.example.invalid:8080/mcp', tools: ['search'] }],
        secrets: ['graph-token', 'atlas-token'],
        secretValues: { 'graph-token': VALUE, 'atlas-token': 'test-value-two' },
      }),
    );

    expect(replaced).toEqual({
      isOk: true,
      value: {
        configuration: {
          version: 1,
          servers: [
            { name: 'atlas', url: 'http://atlas.example.invalid:8080/mcp', tools: ['search'] },
            { name: 'company-graph', url: GRAPH.url, tools: GRAPH.tools, credential: { secret: 'graph-token', header: 'Authorization' } },
          ],
          secrets: [
            { name: 'atlas-token', value: 'test-value-two' },
            { name: 'graph-token', value: VALUE },
          ],
        },
        changed: { servers: ['atlas', 'company-graph'], secrets: ['atlas-token', 'graph-token'] },
      },
    });
  });

  it('shows its metadata with secret names only, never a value', () => {
    const configuration = saved(aReplacement({ servers: [WITH_TOKEN], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }));

    const metadata = mcpConfigurationMetadata(configuration);

    expect(metadata).toEqual({ version: 1, servers: [{ name: 'company-graph', url: GRAPH.url, tools: GRAPH.tools, credential: { secret: 'graph-token', header: 'Authorization' } }], secrets: ['graph-token'] });
    expect(JSON.stringify(metadata)).not.toContain('test-value');
  });

  it('keeps a retained secret without a new value, and names only what changed', () => {
    const first = saved(aReplacement({ servers: [WITH_TOKEN], secrets: ['graph-token', 'spare'], secretValues: { 'graph-token': VALUE, spare: 'test-value-two' } }));

    const replaced = replace(aReplacement({ expectedVersion: 1, servers: [WITH_TOKEN], secrets: ['graph-token', 'spare'], secretValues: { spare: 'test-value-three' } }), first);

    expect(replaced.isOk && replaced.value).toEqual({
      configuration: { version: 2, servers: first.servers, secrets: [{ name: 'graph-token', value: VALUE }, { name: 'spare', value: 'test-value-three' }] },
      changed: { servers: [], secrets: ['spare'] },
    });
  });

  it('deletes a secret left out of the retained list, and a server left out of the list', () => {
    const first = saved(aReplacement({ servers: [WITH_TOKEN], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }));

    const replaced = replace(aReplacement({ expectedVersion: 1 }), first);

    expect(replaced.isOk && replaced.value).toEqual({ configuration: { version: 2, servers: [], secrets: [] }, changed: { servers: ['company-graph'], secrets: ['graph-token'] } });
  });

  it('moves the version on when clearing a set that is empty already', () => {
    expect(replace(aReplacement()).isOk && saved(aReplacement()).version).toBe(1);
  });

  it('refuses a stale expected version as a conflict', () => {
    const first = saved(aReplacement());

    expect(replace(aReplacement({ expectedVersion: 0 }), first)).toEqual({ isOk: false, error: { kind: 'VERSION_CONFLICT', message: 'The MCP configuration is at version 1, not 0: read it again before replacing it' } });
  });

  it('refuses a server whose credential names a secret the replacement does not retain', () => {
    const first = saved(aReplacement({ servers: [WITH_TOKEN], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }));

    expect(replace(aReplacement({ expectedVersion: 1, servers: [WITH_TOKEN] }), first)).toEqual({
      isOk: false,
      error: { kind: 'INVALID_CONFIGURATION', message: 'company-graph: its credential names the secret graph-token, which the replacement does not retain' },
    });
  });

  it('refuses a retained secret that neither exists nor gets a value', () => {
    expect(replace(aReplacement({ secrets: ['graph-token'] }))).toEqual({
      isOk: false,
      error: { kind: 'INVALID_CONFIGURATION', message: 'graph-token: a retained secret needs a value until it holds one' },
    });
  });

  it('refuses a value for a secret the retained list leaves out, telling it by position', () => {
    expect(replace(aReplacement({ secretValues: { [VALUE]: 'graph-token' } }))).toEqual({
      isOk: false,
      error: { kind: 'INVALID_CONFIGURATION', message: 'secret value 1: names no secret the replacement retains' },
    });
  });

  it.each([
    ['a server name with capitals', aReplacement({ servers: [{ ...GRAPH, name: 'Graph' }] }), /^server 1: /],
    ['a server named twice', aReplacement({ servers: [GRAPH, GRAPH] }), /^company-graph: a server is named once$/],
    ['a URL that is not a URL', aReplacement({ servers: [{ ...GRAPH, url: 'graph.example.invalid' }] }), /^company-graph: an MCP server is an http/],
    ['a stdio command', aReplacement({ servers: [{ ...GRAPH, url: 'stdio:npx mcp-neo4j-cypher' }] }), /^company-graph: /],
    ['a URL with a user and password', aReplacement({ servers: [{ ...GRAPH, url: 'https://me:secret@graph.example.invalid/mcp' }] }), /^company-graph: /],
    ['a URL with a query', aReplacement({ servers: [{ ...GRAPH, url: 'https://graph.example.invalid/mcp?token=abc' }] }), /^company-graph: /],
    ['a URL with a fragment', aReplacement({ servers: [{ ...GRAPH, url: 'https://graph.example.invalid/mcp#abc' }] }), /^company-graph: /],
    ['a server with no tool', aReplacement({ servers: [{ ...GRAPH, tools: [] }] }), /^company-graph: a server lists the tools a session may call$/],
    ['a tool listed twice', aReplacement({ servers: [{ ...GRAPH, tools: ['read', 'read'] }] }), /^company-graph: a tool is listed once$/],
    ['a tool with no name', aReplacement({ servers: [{ ...GRAPH, tools: [''] }] }), /^company-graph: a tool has a name$/],
    ['a header the proxy sets itself', aReplacement({ servers: [{ ...GRAPH, credential: { secret: 'graph-token', header: 'Host' } }], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }), /^company-graph: a credential header/],
    ['a header with a space', aReplacement({ servers: [{ ...GRAPH, credential: { secret: 'graph-token', header: 'X Key' } }], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }), /^company-graph: a credential header/],
    ['a Proxy- header', aReplacement({ servers: [{ ...GRAPH, credential: { secret: 'graph-token', header: 'Proxy-Authorization' } }], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }), /^company-graph: a credential header/],
    ['a secret name that is not a name', aReplacement({ secrets: [VALUE], secretValues: {} }), /^secret 1: /],
    ['a secret retained twice', aReplacement({ secrets: ['graph-token', 'graph-token'], secretValues: { 'graph-token': VALUE } }), /^graph-token: a secret is retained once$/],
    ['an empty value', aReplacement({ secrets: ['graph-token'], secretValues: { 'graph-token': '' } }), /^graph-token: a value is 1 to 8192 bytes/],
    ['a value with a line feed', aReplacement({ secrets: ['graph-token'], secretValues: { 'graph-token': `${VALUE}\nX-Other: 1` } }), /^graph-token: a value is 1 to 8192 bytes/],
    ['a value with a carriage return', aReplacement({ secrets: ['graph-token'], secretValues: { 'graph-token': `${VALUE}\r` } }), /^graph-token: /],
    ['a value with a NUL', aReplacement({ secrets: ['graph-token'], secretValues: { 'graph-token': `${VALUE}\u0000` } }), /^graph-token: /],
    ['a value one byte over 8192', aReplacement({ secrets: ['graph-token'], secretValues: { 'graph-token': 'a'.repeat(8193) } }), /^graph-token: /],
  ])('refuses %s, the whole replacement, never naming a value', (_label, replacement, reason) => {
    const replaced = replace(replacement);

    expect(replaced.isOk).toBe(false);
    expect(!replaced.isOk && replaced.error.kind).toBe('INVALID_CONFIGURATION');
    expect(!replaced.isOk && replaced.error.message).toMatch(reason);
    expect(JSON.stringify(replaced)).not.toContain('test-value');
  });

  it('takes a value of exactly 8192 bytes', () => {
    expect(replace(aReplacement({ secrets: ['graph-token'], secretValues: { 'graph-token': 'a'.repeat(8192) } })).isOk).toBe(true);
  });

  it('refuses a set that would not fit one message once sealed, and takes one that just fits', () => {
    const names = Array.from({ length: 40 }, (_, index) => `secret-${String(index).padStart(2, '0')}`);
    const values = (bytes: number) => Object.fromEntries(names.map((name) => [name, 'a'.repeat(bytes)]));

    expect(replace(aReplacement({ secrets: names, secretValues: values(6000) })).isOk).toBe(true);
    expect(replace(aReplacement({ secrets: names, secretValues: values(8000) }))).toEqual({
      isOk: false,
      error: { kind: 'INVALID_CONFIGURATION', message: 'the MCP configuration does not fit one message of 256 KB once sealed' },
    });
  });
});

describe("the message that carries a fleet's MCP configuration to a trierarch", () => {
  it('holds the fleet, the plugin ship, the version, the key and each server and sealed secret, in that order', () => {
    const configuration = saved(aReplacement({ servers: [WITH_TOKEN], secrets: ['graph-token'], secretValues: { 'graph-token': VALUE } }));

    const payload = mcpConfigurationPayload({ fleetId: FLEET_ID, pluginShipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a', version: configuration.version, publicKey: 'key=', servers: configuration.servers, secrets: [{ name: 'graph-token', sealed: 'c2VhbGVk' }] });

    expect(payload).toBe(
      `{"fleetId":"${FLEET_ID}","pluginShipId":"shp_01m3tbfspe96yf1rnr4ank9h1a","version":1,"publicKey":"key=","servers":[{"name":"company-graph","url":"https://graph.example.invalid/mcp","transport":"streamable-http","tools":["read_neo4j_cypher","get_neo4j_schema"],"credential":{"secret":"graph-token","header":"Authorization"}}],"secrets":[{"name":"graph-token","sealed":"c2VhbGVk"}]}`,
    );
  });

  it('carries an empty set too', () => {
    expect(mcpConfigurationPayload({ fleetId: FLEET_ID, pluginShipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a', version: 0, publicKey: 'key=', servers: [], secrets: [] })).toBe(
      `{"fleetId":"${FLEET_ID}","pluginShipId":"shp_01m3tbfspe96yf1rnr4ank9h1a","version":0,"publicKey":"key=","servers":[],"secrets":[]}`,
    );
  });
});
