import { describe, expect, it } from 'vitest';

import { mcpServersPayload, readMcpServers } from './mcp-servers.js';

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
    ['a field it does not know, such as a credential', { graph: { ...GRAPH, token: 'abc' } }],
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
});
