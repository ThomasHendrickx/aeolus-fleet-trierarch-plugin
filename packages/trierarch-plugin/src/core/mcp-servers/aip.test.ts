import { describe, expect, it } from 'vitest';

import { aipPayload, readAip } from './aip.js';

const AIP = { server: 'https://aip.example.invalid', tokenSecret: 'aip-token' };

describe('the AIP', () => {
  it('is read as a server URL and the name of the secret that holds its token', () => {
    expect(readAip(AIP)).toEqual({ isOk: true, value: AIP });
  });

  it('goes in the payload by secret name, never a value', () => {
    const read = readAip(AIP);

    expect(read.isOk && aipPayload(read.value)).toBe('{"server":"https://aip.example.invalid","tokenSecret":"aip-token"}');
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
    expect(readAip(listed).isOk).toBe(false);
  });

  it('is refused with a reason that holds no value it was given', () => {
    const read = readAip({ ...AIP, tokenSecret: 'leaked value!' });

    expect(!read.isOk && read.error.reason).toBe('tokenSecret is missing or not valid');
  });
});
