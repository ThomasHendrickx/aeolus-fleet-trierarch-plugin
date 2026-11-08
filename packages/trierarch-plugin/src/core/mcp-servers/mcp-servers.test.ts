import { describe, expect, it } from 'vitest';

import { mcpServersPayload, readMcpServers, withAip } from './mcp-servers.js';

const GRAPH = { url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher', 'get_neo4j_schema'] };

describe('the crew-time MCP servers', () => {
  it('reads each server by name with its URL and the tools a session may call, in name order', () => {
    const read = readMcpServers({ 'company-graph': GRAPH, atlas: { url: 'http://atlas.example.invalid:8080/mcp', tools: ['search'] } });

    expect(read).toEqual({
      isOk: true,
      value: {
        servers: [
          { name: 'atlas', url: 'http://atlas.example.invalid:8080/mcp', tools: ['search'] },
          { name: 'company-graph', url: 'https://graph.example.invalid/mcp', tools: ['read_neo4j_cypher', 'get_neo4j_schema'] },
        ],
      },
    });
  });

  it('reads a server with the credential the proxy adds: a secret by name and the header it goes in', () => {
    const read = readMcpServers({ graph: { ...GRAPH, credential: { secret: 'graph-token', header: 'Authorization' } } });

    expect(read.isOk && read.value.servers).toEqual([{ name: 'graph', url: GRAPH.url, tools: GRAPH.tools, credential: { secret: 'graph-token', header: 'Authorization' } }]);
  });

  it('reads a secret name of exactly 100 characters and a header of every token character', () => {
    const header = "X-Key_1!#$%&'*+.^`|~";

    const read = readMcpServers({ graph: { ...GRAPH, credential: { secret: 'a'.repeat(100), header } } });

    expect(read.isOk && read.value.servers[0]?.credential).toEqual({ secret: 'a'.repeat(100), header });
  });

  it('reads none from an empty list', () => {
    expect(readMcpServers({})).toEqual({ isOk: true, value: { servers: [] } });
  });

  it.each([
    ['a list that is no object', [GRAPH]],
    ['a list that is text', 'company-graph'],
    ['a name with capitals', { Graph: GRAPH }],
    ['a name that is a path', { 'a/b': GRAPH }],
    ['a server that is no object', { graph: 'https://graph.example.invalid/mcp' }],
    ['a server without a URL', { graph: { tools: ['read'] } }],
    ['a URL that is no text', { graph: { ...GRAPH, url: 1 } }],
    ['a URL that is not a URL', { graph: { ...GRAPH, url: 'graph.example.invalid' } }],
    ['a stdio command', { graph: { ...GRAPH, url: 'stdio:npx mcp-neo4j-cypher' } }],
    ['a file URL', { graph: { ...GRAPH, url: 'file:///srv/mcp' } }],
    ['a URL with a user', { graph: { ...GRAPH, url: 'https://token@graph.example.invalid/mcp' } }],
    ['a URL with a user and password', { graph: { ...GRAPH, url: 'https://me:secret@graph.example.invalid/mcp' } }],
    ['a URL with a query', { graph: { ...GRAPH, url: 'https://graph.example.invalid/mcp?token=abc' } }],
    ['a URL with a fragment', { graph: { ...GRAPH, url: 'https://graph.example.invalid/mcp#abc' } }],
    ['a server without tools', { graph: { url: GRAPH.url } }],
    ['a server with an empty tool list', { graph: { ...GRAPH, tools: [] } }],
    ['tools that are no list', { graph: { ...GRAPH, tools: 'read' } }],
    ['a tool that is no text', { graph: { ...GRAPH, tools: [1] } }],
    ['a tool with no name', { graph: { ...GRAPH, tools: [''] } }],
    ['a tool listed twice', { graph: { ...GRAPH, tools: ['read', 'read'] } }],
    ['a field it does not know, such as a token', { graph: { ...GRAPH, token: 'abc' } }],
    ['a credential that is no object', { graph: { ...GRAPH, credential: 'graph-token' } }],
    ['a credential without a secret', { graph: { ...GRAPH, credential: { header: 'Authorization' } } }],
    ['a credential without a header', { graph: { ...GRAPH, credential: { secret: 'graph-token' } } }],
    ['a credential that holds a value', { graph: { ...GRAPH, credential: { secret: 'graph-token', header: 'Authorization', value: 'abc' } } }],
    ['a secret name with capitals', { graph: { ...GRAPH, credential: { secret: 'Graph', header: 'Authorization' } } }],
    ['a secret name over 100 characters', { graph: { ...GRAPH, credential: { secret: 'a'.repeat(101), header: 'Authorization' } } }],
    ['a header that is no token', { graph: { ...GRAPH, credential: { secret: 'graph-token', header: 'X Api Key' } } }],
    ['a header with a colon', { graph: { ...GRAPH, credential: { secret: 'graph-token', header: 'Authorization:' } } }],
    ['an empty header', { graph: { ...GRAPH, credential: { secret: 'graph-token', header: '' } } }],
    ...['Host', 'content-length', 'Transfer-Encoding', 'Connection', 'Upgrade', 'TE', 'Trailer', 'Keep-Alive', 'Proxy-Authorization', 'proxy-connection', 'Cookie', 'Content-Type', 'accept', 'Accept-Encoding', 'Last-Event-ID', 'Mcp-Session-Id', 'MCP-Protocol-Version'].map(
      (header): [string, unknown] => [`the header ${header}`, { graph: { ...GRAPH, credential: { secret: 'graph-token', header } } }],
    ),
  ])('refuses %s', (_label, listed) => {
    const read = readMcpServers(listed);

    expect(read.isOk).toBe(false);
    expect(!read.isOk && read.error.reason).not.toBe('');
  });

  it('names the server at fault in the reason', () => {
    const read = readMcpServers({ graph: { ...GRAPH, tools: [] } });

    expect(!read.isOk && read.error.reason).toMatch(/^graph: /);
  });

  it('refuses a list too large for one message', () => {
    const tools = Array.from({ length: 300 }, (_, index) => `tool_${String(index)}_${'x'.repeat(1000)}`);

    const read = readMcpServers({ graph: { ...GRAPH, tools } });

    expect(!read.isOk && read.error.reason).toBe('the MCP servers do not fit one message of 256 KB');
  });

  it('puts the list in the payload as a trierarch receives it', () => {
    const read = readMcpServers({ graph: GRAPH });

    expect(read.isOk && mcpServersPayload(read.value)).toBe(
      '{"servers":[{"name":"graph","url":"https://graph.example.invalid/mcp","transport":"streamable-http","tools":["read_neo4j_cypher","get_neo4j_schema"]}]}',
    );
  });

  it('puts a server\'s credential in the payload by secret name and header, never a value', () => {
    const read = readMcpServers({ graph: { ...GRAPH, credential: { secret: 'graph-token', header: 'Authorization' } } });

    expect(read.isOk && mcpServersPayload(read.value)).toBe(
      '{"servers":[{"name":"graph","url":"https://graph.example.invalid/mcp","transport":"streamable-http","tools":["read_neo4j_cypher","get_neo4j_schema"],"credential":{"secret":"graph-token","header":"Authorization"}}]}',
    );
  });

  describe('the aip', () => {
    const AIP = { server: 'https://aip.example.invalid', tokenSecret: 'aip-token' };
    const NONE = { servers: [] };

    it('is read as a server URL and the name of the secret that holds its token', () => {
      expect(withAip(NONE, AIP)).toEqual({ isOk: true, value: { servers: [], aip: AIP } });
    });

    it('goes in the payload after the servers, by secret name, never a value', () => {
      const added = withAip(NONE, AIP);

      expect(added.isOk && mcpServersPayload(added.value)).toBe('{"servers":[],"aip":{"server":"https://aip.example.invalid","tokenSecret":"aip-token"}}');
    });

    it.each([
      ['not an object', 'https://aip.example.invalid'],
      ['an array', []],
      ['no server', { tokenSecret: 'aip-token' }],
      ['no token secret', { server: 'https://aip.example.invalid' }],
      ['a server that is not http', { ...AIP, server: 'ftp://aip.example.invalid' }],
      ['a server URL that holds a credential', { ...AIP, server: 'https://me:secret@aip.example.invalid' }],
      ['a server URL with a query', { ...AIP, server: 'https://aip.example.invalid?token=x' }],
      ['a token secret that is no name', { ...AIP, tokenSecret: 'not a name!' }],
      ['another field', { ...AIP, extra: 'x' }],
    ])('is refused when it is %s', (_label, listed) => {
      expect(withAip(NONE, listed).isOk).toBe(false);
    });

    it('is refused with a reason that holds no value it was given', () => {
      const added = withAip(NONE, { ...AIP, tokenSecret: 'leaked value!' });

      expect(!added.isOk && added.error.reason).toMatch(/^the AIP: /);
      expect(!added.isOk && added.error.reason).not.toMatch(/leaked/);
    });
  });
});
