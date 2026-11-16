import { describe, expect, it } from 'vitest';

import { setupLineOf } from './setup-line.js';

const BASE = 'curl -fsSL https://raw.githubusercontent.com/ThomasHendrickx/aeolus-fleet-trierarch/main/install.sh | sh -s -- --fleet-url https://fleet.example --ship-id shp_machine --plugin-ship-id shp_plugin --secret aeolus_sk_v1_machine';

const resultOf = (options?: Parameters<typeof setupLineOf>[1]) =>
  setupLineOf({ fleetUrl: 'https://fleet.example', shipId: 'shp_machine', pluginShipId: 'shp_plugin', secret: 'aeolus_sk_v1_machine' }, options);

/** The line of options the domain accepts. */
const line = (options?: Parameters<typeof setupLineOf>[1]) => {
  const made = resultOf(options);
  expect(made.isOk).toBe(true);
  return made.isOk ? made.value : '';
};

describe('the setup line of a machine', () => {
  it('carries service consent, both limits and repeated folders as separate quoted words', () => {
    expect(line({
      service: 'yes', maxShips: 4, maxRunning: 2,
      folders: { kind: 'list', entries: [{ name: 'shared', path: "/srv/it's shared;$(id)" }, { name: 'notes', path: '~/notes' }] },
    })).toBe(`${BASE} --folder 'shared' '/srv/it'\\''s shared;$(id)' --folder 'notes' '~/notes' --max-ships 4 --max-running 2 --service yes`);
  });

  it('carries explicit no folders and declined service without changing their meaning', () => {
    expect(line({ folders: { kind: 'none' }, service: 'no' })).toBe(`${BASE} --no-folders --service no`);
    expect(line({ folders: { kind: 'list', entries: [] } })).toBe(BASE);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('refuses an invalid ship or session limit %s', (limit) => {
    expect(resultOf({ maxShips: limit }).isOk).toBe(false);
    expect(resultOf({ maxRunning: limit }).isOk).toBe(false);
  });

  it('accepts independently chosen positive limits including one session and more sessions than ships', () => {
    expect(line({ maxShips: 1, maxRunning: 2 })).toBe(`${BASE} --max-ships 1 --max-running 2`);
    expect(line({ maxRunning: 1 })).toBe(`${BASE} --max-running 1`);
  });

  it('refuses NUL in a folder name or path before generating a shell word', () => {
    expect(resultOf({ folders: { kind: 'list', entries: [{ name: 'a\0b', path: '/ok' }] } }).isOk).toBe(false);
    expect(resultOf({ folders: { kind: 'list', entries: [{ name: 'ok', path: '/a\0b' }] } }).isOk).toBe(false);
  });

  it('carries no option flag when no option is filled, so the machine asks for each', () => {
    expect(line()).toBe(BASE);
    expect(line({})).toBe(BASE);
    expect(line({ harnesses: [], unattended: [], repositories: { kind: 'list', entries: ['', ''] } })).toBe(BASE);
  });

  it('carries every filled option as its flag, and never --clone-into', () => {
    const filled = line({
      harnesses: ['claude-code', 'codex'],
      unattended: ['claude-code'],
      repositories: { kind: 'list', entries: ['~/code/web', '/srv/api', '', 'https://github.com/acme/docs.git'] },
    });

    expect(filled).toBe(`${BASE} --harnesses claude-code,codex --unattended claude-code --repositories '~/code/web,/srv/api,https://github.com/acme/docs.git'`);
    expect(filled).not.toContain('--clone-into');
  });

  it('carries a folder of repositories as --repositories-in', () => {
    expect(line({ harnesses: ['codex'], repositories: { kind: 'folder', path: '~/code' } })).toBe(`${BASE} --harnesses codex --repositories-in '~/code'`);
  });

  it('carries none as --no-repositories', () => {
    expect(line({ harnesses: ['copilot'], repositories: { kind: 'none' } })).toBe(`${BASE} --harnesses copilot --no-repositories`);
  });

  it('drops the --unattended entry of a harness that is not picked, and the flag when none is left', () => {
    expect(line({ harnesses: ['codex'], unattended: ['claude-code', 'codex'] })).toBe(`${BASE} --harnesses codex --unattended codex`);
    expect(line({ harnesses: ['codex'], unattended: ['claude-code'] })).toBe(`${BASE} --harnesses codex`);
    expect(line({ unattended: ['claude-code'] })).toBe(BASE);
  });

  it('names a harness once though it is given twice', () => {
    expect(line({ harnesses: ['codex', 'codex'], unattended: ['codex', 'codex'] })).toBe(`${BASE} --harnesses codex --unattended codex`);
  });

  it.each([
    ['a single quote', "/srv/it's"],
    ['a space', '/srv/my code'],
    ['a command substitution', '/srv/$(touch /tmp/pwned)'],
    ['a backtick', '/srv/`id`'],
    ['a pipe and an ampersand', '/srv/a | b && c'],
    ['a line break', '/srv/a\nrm -rf ~'],
    ['a double quote', '/srv/"a"'],
  ])('keeps a path with %s inside one quoted word', (_what, path) => {
    const quoted = `'${path.replaceAll("'", "'\\''")}'`;

    expect(line({ repositories: { kind: 'list', entries: [path] } })).toBe(`${BASE} --repositories ${quoted}`);
    expect(line({ repositories: { kind: 'folder', path } })).toBe(`${BASE} --repositories-in ${quoted}`);
  });

  it('takes any folder path as --repositories-in, a comma or semicolon included, in one quoted word', () => {
    expect(line({ repositories: { kind: 'folder', path: '/srv/a,b;c' } })).toBe(`${BASE} --repositories-in '/srv/a,b;c'`);
  });

  it('keeps a hostile folder path with a semicolon and quotes in one word, written out literally', () => {
    expect(line({ repositories: { kind: 'folder', path: `/x'; rm -rf ~ #"` } })).toBe(`${BASE} --repositories-in '/x'\\''; rm -rf ~ #"'`);
  });

  it('keeps a hostile list entry with quotes in one word, written out literally', () => {
    expect(line({ repositories: { kind: 'list', entries: [`/x'$(id)"`, '/y'] } })).toBe(`${BASE} --repositories '/x'\\''$(id)",/y'`);
  });

  it('refuses a list entry holding a comma, because the trierarch splits --repositories there, naming it', () => {
    expect(resultOf({ repositories: { kind: 'list', entries: ['/ok', '/a,b'] } })).toEqual({
      isOk: false,
      error: { kind: 'INVALID_SETUP_OPTION', message: 'A repository path or git URL holds no comma: the trierarch splits the list there' },
    });
  });

  it('refuses a list entry holding a semicolon, naming it, though the same path is fine as a folder', () => {
    expect(resultOf({ repositories: { kind: 'list', entries: ["/x'; rm -rf ~"] } })).toEqual({
      isOk: false,
      error: { kind: 'INVALID_SETUP_OPTION', message: 'A repository path or git URL holds no semicolon: the trierarch splits the list there' },
    });
    expect(resultOf({ repositories: { kind: 'folder', path: "/x'; rm -rf ~" } }).isOk).toBe(true);
  });

  it('refuses a NUL in any value: a shell word cannot hold it', () => {
    expect(resultOf({ repositories: { kind: 'folder', path: '/a\0b' } }).isOk).toBe(false);
    expect(resultOf({ repositories: { kind: 'list', entries: ['/a\0b'] } }).isOk).toBe(false);
  });
});
