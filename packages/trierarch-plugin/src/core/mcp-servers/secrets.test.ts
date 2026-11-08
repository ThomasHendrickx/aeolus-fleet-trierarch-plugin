import { describe, expect, it } from 'vitest';

import { readMcpServers, withAip, type McpServers } from './mcp-servers.js';
import { readSecrets } from './secrets.js';

const VALUE = 'Bearer test-value-not-a-real-token';

function aList(listed: Record<string, unknown>): McpServers {
  const read = readMcpServers(listed);
  return read.isOk ? read.value : { servers: [] };
}

const NONE = aList({});
const GRAPH_WITH_CREDENTIAL = aList({ graph: { url: 'https://graph.example.invalid/mcp', tools: ['read'], credential: { secret: 'graph-token', header: 'Authorization' } } });

describe('the secret store', () => {
  it('reads each secret by name with its value, in name order', () => {
    const read = readSecrets({ 'graph-token': VALUE, atlas: 'x' }, NONE);

    expect(read).toEqual({ isOk: true, value: { secrets: [{ name: 'atlas', value: 'x' }, { name: 'graph-token', value: VALUE }] } });
  });

  it('reads none from an empty store', () => {
    expect(readSecrets({}, NONE)).toEqual({ isOk: true, value: { secrets: [] } });
  });

  it('reads a value of exactly 8192 bytes of UTF-8', () => {
    const value = 'é'.repeat(4096);

    expect(readSecrets({ big: value }, NONE).isOk).toBe(true);
  });

  it('reads the secret a server names as its credential', () => {
    expect(readSecrets({ 'graph-token': VALUE }, GRAPH_WITH_CREDENTIAL).isOk).toBe(true);
  });

  it.each([
    ['a store that is no object', [VALUE]],
    ['a store that is text', VALUE],
    ['a name with capitals', { Graph: VALUE }],
    ['a name that is a path', { 'a/b': VALUE }],
    ['a name over 100 characters', { ['a'.repeat(101)]: VALUE }],
    ['a value that is no text', { graph: 1 }],
    ['an empty value', { graph: '' }],
    ['a value over 8192 bytes of UTF-8', { graph: `${'é'.repeat(4096)}x` }],
    ['a value with a carriage return', { graph: 'Bearer a\rb' }],
    ['a value with a line feed', { graph: 'Bearer a\nb' }],
    ['a value with a NUL', { graph: 'Bearer a\u0000b' }],
  ])('refuses %s', (_label, listed) => {
    const read = readSecrets(listed, NONE);

    expect(read.isOk).toBe(false);
    expect(!read.isOk && read.error.reason).not.toBe('');
  });

  it('names the secret at fault in the reason, never its value', () => {
    const read = readSecrets({ graph: 'Bearer leaked\nvalue' }, NONE);

    expect(!read.isOk && read.error.reason).toBe('graph: a value is 1 to 8192 bytes of UTF-8 with no CR, LF or NUL');
  });

  it.each([
    ['a value in the place of a name', { listed: { 'Bearer leaked value': 'graph-token' }, position: 'entry 1' }],
    ['a second entry that fails the name rules', { listed: { atlas: VALUE, 'Bearer leaked value': 'graph-token' }, position: 'entry 2' }],
  ])('says which entry by position when %s, never the name', (_label, { listed, position }) => {
    const read = readSecrets(listed, NONE);

    expect(!read.isOk && read.error.reason).toMatch(new RegExp(`^${position}: `));
    expect(!read.isOk && read.error.reason).not.toContain('leaked');
    expect(!read.isOk && read.error.reason).not.toContain('graph-token');
  });

  it('refuses a server whose credential names a secret the store does not hold', () => {
    const read = readSecrets({ other: VALUE }, GRAPH_WITH_CREDENTIAL);

    expect(!read.isOk && read.error.reason).toBe('graph: its credential names the secret graph-token, which the store does not hold');
  });

  it('refuses a store too large for one message once sealed', () => {
    const listed = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`secret-${String(index).padStart(2, '0')}`, 'x'.repeat(8192)]));

    const read = readSecrets(listed, NONE);

    expect(!read.isOk && read.error.reason).toBe('the secrets do not fit one message of 256 KB once sealed');
  });

  it('reads a store that fits one message once sealed', () => {
    const listed = Object.fromEntries(Array.from({ length: 23 }, (_, index) => [`secret-${String(index).padStart(2, '0')}`, 'x'.repeat(8192)]));

    expect(readSecrets(listed, NONE).isOk).toBe(true);
  });

  describe('with the aip', () => {
    const WITH_AIP = ((): McpServers => {
      const added = withAip(NONE, { server: 'https://aip.example.invalid', tokenSecret: 'aip-token' });
      return added.isOk ? added.value : NONE;
    })();

    it('holds the secret its token names', () => {
      expect(readSecrets({ 'aip-token': VALUE }, WITH_AIP).isOk).toBe(true);
    });

    it('never names the secret in the refusal, which may be the token itself', () => {
      const token = 'ab12cd34ef56ab12cd34ef56ab12cd34';
      const added = withAip(NONE, { ...{ server: 'https://aip.example.invalid' }, tokenSecret: token });
      const read = readSecrets({ other: VALUE }, added.isOk ? added.value : NONE);

      expect(!read.isOk && read.error.reason).not.toContain(token);
    });

    it('refuses a store that lacks the secret its token names, naming the secret, never a value', () => {
      const read = readSecrets({ other: VALUE }, WITH_AIP);

      expect(!read.isOk && read.error.reason).toBe('the AIP: its token secret is not in the store');
    });
  });
});
