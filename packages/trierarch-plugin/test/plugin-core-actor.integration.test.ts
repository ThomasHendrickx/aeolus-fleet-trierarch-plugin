import { generateKeyPairSync, sign } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, createMigratedDatabase, createPrismaClient as createCoreClient, createUseCases, FLEET_URL, newKey, operatorCaller, secretOf, unwrap } from '@aeolus-fleet/core/testing';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createTrierarchPluginApp } from '../src/app.js';
import { createPluginDatabase } from '../src/testing/database.js';

describe('repository calls through core', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });

  it('preserves agent and account actors and applies live scope revocation', async () => {
    const coreDatabaseUrl = await createMigratedDatabase();
    const coreDb = createCoreClient(coreDatabaseUrl);
    cleanup.push(() => coreDb.$disconnect());
    const useCases = createUseCases({ prisma: coreDb });
    const argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet' })));
    const plugin = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'plugin', type: 'trierarch-plugin', kind: 'plugin', scopes: ['scopes:declare'] }));
    unwrap(await useCases.declareScopes({ fleetId: argo.fleetId, shipId: plugin.shipId, kind: 'plugin', scopes: ['scopes:declare'] }, { namespace: 'trierarch', scopes: [{ scope: 'trierarch:repositories', description: 'Manage trusted repositories' }] }));
    const agent = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'agent', type: 'agent', scopes: ['trierarch:repositories'] }));
    const pluginDatabaseUrl = await createPluginDatabase();
    const pluginDb = createPrismaClient(pluginDatabaseUrl);
    cleanup.push(() => pluginDb.$disconnect());
    await pluginDb.connection.create({ data: { fleetId: argo.fleetId, shipId: plugin.shipId, shipName: 'plugin', crewToken: 'test-plugin-token', crewedAt: new Date() } });
    const secret = 'the-internal-test-secret-is-long-enough';
    const pluginApp = createTrierarchPluginApp({ databaseUrl: pluginDatabaseUrl, fleetUrl: FLEET_URL, logger: false, pluginSecrets: [secret] });
    cleanup.push(() => pluginApp.close());
    const internalUrl = await pluginApp.pluginServer.listen({ host: '127.0.0.1', port: 0 });
    const keys = generateKeyPairSync('ed25519');
    const issuerServer = Fastify();
    issuerServer.get('/.well-known/jwks.json', () => ({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'EdDSA', use: 'sig' }] }));
    cleanup.push(() => issuerServer.close());
    const issuer = await issuerServer.listen({ host: '127.0.0.1', port: 0 });
    const core = createApp({ databaseUrl: coreDatabaseUrl, publicUrl: FLEET_URL, logger: false, accountTokenIssuer: issuer, pluginTargets: [{ fleetId: argo.fleetId, pluginShipId: plugin.shipId, url: `${internalUrl}/dispatch`, secret }] });
    cleanup.push(() => core.close());
    const coreUrl = await core.listen({ host: '127.0.0.1', port: 0 });
    const registered = unwrap(await createRestFleetDoor(coreUrl).register({ shipId: agent.shipId, secret: secretOf(agent.secret) }));
    const call = () => fetch(`${coreUrl}/api/v1/fleet/callPlugin`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${registered.crewToken}` }, body: JSON.stringify({ pluginShipId: plugin.shipId, procedure: 'repositories.add', input: { name: 'main', url: 'https://example.com/a.git', expectedVersion: 0 } }) });
    const added = await call();
    expect(added.status).toBe(200);
    const events = await pluginDb.$queryRaw<{ actor: unknown }[]>`SELECT actor FROM repository_events WHERE fleet_id = ${argo.fleetId}`;
    expect(events).toEqual([{ actor: { kind: 'ship', shipId: agent.shipId } }]);
    unwrap(await useCases.grantScopes(argo, { shipId: agent.shipId, grant: [], revoke: ['trierarch:repositories'] }));
    expect((await call()).status).toBe(403);
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'EdDSA', typ: 'at+jwt', kid: 'test-key' })}.${encode({ iss: issuer, aud: argo.fleetId, sub: 'account-1', org: 'organisation-1', scope: 'trierarch:repositories', group: [], iat: now, exp: now + 300 })}`;
    const accountToken = `${unsigned}.${sign(null, Buffer.from(unsigned), keys.privateKey).toString('base64url')}`;
    const account = await fetch(`${coreUrl}/api/v1/fleet/callPlugin`, { method: 'POST', headers: { 'content-type': 'application/json', 'aeolus-account-token': accountToken }, body: JSON.stringify({ pluginShipId: plugin.shipId, procedure: 'repositories.remove', input: { name: 'main', expectedVersion: 1 } }) });
    expect(account.status).toBe(200);
    const actorEvents = await pluginDb.$queryRaw<{ actor: unknown }[]>`SELECT actor FROM repository_events WHERE fleet_id = ${argo.fleetId} ORDER BY version`;
    expect(actorEvents[1]).toEqual({ actor: { kind: 'account', accountId: 'account-1', throughShipId: null } });
  });
});
