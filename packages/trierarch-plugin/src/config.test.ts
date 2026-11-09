import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const environment = {
  DATABASE_URL: 'postgres://trierarch@localhost:5432/trierarch_plugin',
  FLEET_URL: 'https://fleet.example.com',
};

describe('loadConfig', () => {
  it('reads the database and the fleet, and listens on 127.0.0.1:4200 by default', () => {
    expect(loadConfig(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      fleetUrl: 'https://fleet.example.com',
      consoleOrigin: 'https://fleet.example.com',
      host: '127.0.0.1',
      port: 4200,
      logLevel: 'info',
      installationToken: undefined,
      silentAfterMs: 300_000,
      passIntervalMs: 10_000,
      trustedRepositories: { repositories: [] },
    });
  });

  it("takes the console's origin as CONSOLE_ORIGIN, and the origin of FLEET_URL without it", () => {
    expect(loadConfig({ ...environment, FLEET_URL: 'https://fleet.example.com/aeolus/' }).consoleOrigin).toBe('https://fleet.example.com');
    expect(loadConfig({ ...environment, CONSOLE_ORIGIN: 'https://console.example.com' }).consoleOrigin).toBe('https://console.example.com');
  });

  it.each(['console.example.com', 'https://console.example.com/path', 'ftp://console.example.com'])('refuses a CONSOLE_ORIGIN of %s, which is no origin', (origin) => {
    expect(() => loadConfig({ ...environment, CONSOLE_ORIGIN: origin })).toThrow(/^CONSOLE_ORIGIN: /);
  });

  it('reads the trusted repositories as JSON of names to git URLs', () => {
    expect(loadConfig({ ...environment, TRUSTED_REPOSITORIES: '{"hemma":"git@github.com:ThomasHendrickx/hemma.git"}' }).trustedRepositories).toEqual({
      repositories: [{ name: 'hemma', url: 'git@github.com:ThomasHendrickx/hemma.git' }],
    });
  });

  it('reads no MCP servers, secrets or AIP from the environment: each fleet keeps its own set in the plugin, and the old variables are never a fallback', () => {
    const configured = loadConfig({
      ...environment,
      MCP_SERVERS: '{"graph":{"url":"https://graph.example.invalid/mcp","tools":["read"]}}',
      MCP_SECRETS: '{"graph-token":"Bearer test-value-leaked"}',
      AIP: '{"server":"https://aip.example.invalid","tokenSecret":"aip-token"}',
    });

    expect(configured).toEqual(loadConfig(environment));
    expect(JSON.stringify(configured)).not.toContain('test-value-leaked');
  });

  it('reads the silent threshold and the pass interval in seconds', () => {
    expect(loadConfig({ ...environment, TRIERARCH_SILENT_AFTER_SECONDS: '60', TRIERARCH_PASS_INTERVAL_SECONDS: '2' })).toMatchObject({ silentAfterMs: 60_000, passIntervalMs: 2_000 });
  });

  it('reads the installation token, which turns on the installation procedures', () => {
    expect(loadConfig({ ...environment, INSTALLATION_TOKEN: 'x'.repeat(32) }).installationToken).toBe('x'.repeat(32));
  });

  it('reads no ship and no secret: the operator connects the trierarch plugin in the console', () => {
    const configured = loadConfig({ ...environment, PLUGIN_SHIP_ID: 'shp_01m3tbfspe96yf1rnr4ank9h1a', PLUGIN_SHIP_SECRET: 'aeolus_sk_v1_secret' });

    expect(JSON.stringify(configured)).not.toContain('aeolus_sk_v1_secret');
  });

  it.each([
    ['no database', { ...environment, DATABASE_URL: undefined }],
    ['a fleet URL that is not http', { ...environment, FLEET_URL: 'ftp://fleet.example.com' }],
    ['an installation token shorter than 32 characters', { ...environment, INSTALLATION_TOKEN: 'x'.repeat(31) }],
    ['a silent threshold of no seconds', { ...environment, TRIERARCH_SILENT_AFTER_SECONDS: '0' }],
    ['trusted repositories that are not JSON', { ...environment, TRUSTED_REPOSITORIES: 'hemma=git@github.com:a/b.git' }],
    ['a trusted repository whose ssh user does not decode', { ...environment, TRUSTED_REPOSITORIES: '{"hemma":"ssh://%zz@github.com/a/b.git"}' }],
    ['a trusted repository whose URL holds a credential', { ...environment, TRUSTED_REPOSITORIES: '{"hemma":"https://me:secret@github.com/a/b.git"}' }],
  ])('refuses %s', (_label, invalid) => {
    expect(() => loadConfig(invalid)).toThrow(ConfigError);
  });
});
