import { describe, expect, it } from 'vitest';

import { readTrustedRepositories, trustedRepositoriesPayload } from './trusted-repositories.js';

describe('the trusted repositories', () => {
  it('reads each name with its git URL, by name', () => {
    const read = readTrustedRepositories({
      hemma: 'git@github.com:ThomasHendrickx/hemma.git',
      'aeolus-fleet': 'https://github.com/ThomasHendrickx/aeolus-fleet.git',
      skills: 'ssh://git@github.com/ThomasHendrickx/skills.git',
    });

    expect(read).toEqual({
      isOk: true,
      value: {
        repositories: [
          { name: 'aeolus-fleet', url: 'https://github.com/ThomasHendrickx/aeolus-fleet.git' },
          { name: 'hemma', url: 'git@github.com:ThomasHendrickx/hemma.git' },
          { name: 'skills', url: 'ssh://git@github.com/ThomasHendrickx/skills.git' },
        ],
      },
    });
  });

  it('reads none from an empty list', () => {
    expect(readTrustedRepositories({})).toEqual({ isOk: true, value: { repositories: [] } });
  });

  it.each([
    ['a list that is no object', ['https://github.com/a/b.git']],
    ['a list that is text', 'https://github.com/a/b.git'],
    ['a name that is a path', { 'a/b': 'https://github.com/a/b.git' }],
    ['a name with capitals', { Hemma: 'https://github.com/a/b.git' }],
    ['a URL that is no text', { hemma: 1 }],
    ['a plain http URL', { hemma: 'http://github.com/a/b.git' }],
    ['a file URL', { hemma: 'file:///srv/git/hemma.git' }],
    ['a local path', { hemma: '/srv/git/hemma.git' }],
    ['a relative path', { hemma: '../hemma' }],
    ['a remote helper that runs a command', { hemma: 'ext::sh -c touch% /tmp/x' }],
    ['an https URL with a user and password', { hemma: 'https://me:secret@github.com/a/b.git' }],
    ['an https URL with a token as its user', { hemma: 'https://ghp_token@github.com/a/b.git' }],
    ['an ssh URL with a password', { hemma: 'ssh://git:secret@github.com/a/b.git' }],
    ['an ssh URL whose user reads as an option', { hemma: 'ssh://-oProxyCommand=touch%20x@github.com/a/b.git' }],
    ['an scp-like URL whose user reads as an option', { hemma: '-oProxyCommand=x@github.com:a/b.git' }],
    ['an scp-like URL whose host reads as an option', { hemma: 'git@-oProxyCommand=x:a/b.git' }],
    ['a URL that reads as an option', { hemma: '--upload-pack=touch x' }],
    ['a URL with a space', { hemma: 'git@github.com:a/b c.git' }],
    ['a URL with no repository path', { hemma: 'https://github.com/' }],
  ])('refuses %s', (_label, listed) => {
    expect(readTrustedRepositories(listed)).toMatchObject({ isOk: false });
  });

  it('names the repository whose URL it refuses', () => {
    expect(readTrustedRepositories({ hemma: 'file:///srv/git/hemma.git' })).toEqual({
      isOk: false,
      error: { reason: 'hemma: a trusted repository is an https:// or ssh URL, never a path, a file URL or a credential' },
    });
  });

  it('refuses a list that does not fit one message', () => {
    const listed = Object.fromEntries(Array.from({ length: 700 }, (_, index) => [`repository-${String(index)}`, `https://github.com/ThomasHendrickx/${'x'.repeat(60)}-${String(index)}.git`]));

    expect(readTrustedRepositories(listed)).toEqual({ isOk: false, error: { reason: 'the trusted repositories do not fit one message of 64 KB' } });
  });

  it('carries the list to a trierarch as JSON', () => {
    const read = readTrustedRepositories({ hemma: 'git@github.com:ThomasHendrickx/hemma.git' });
    const payload = read.isOk ? trustedRepositoriesPayload(read.value) : read.error.reason;

    expect(JSON.parse(payload)).toEqual({ repositories: [{ name: 'hemma', url: 'git@github.com:ThomasHendrickx/hemma.git' }] });
  });
});
