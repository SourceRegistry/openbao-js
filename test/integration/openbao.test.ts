/**
 * Runs against a real OpenBao dev server:
 *
 *   docker run --rm -p 8200:8200 -e BAO_DEV_ROOT_TOKEN_ID=root openbao/openbao server -dev -dev-listen-address=0.0.0.0:8200
 *   BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN=root npm run test:integration
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { OpenBao, OpenBaoError } from '../../src';

const enabled = !!(process.env.BAO_ADDR && process.env.BAO_TOKEN);
const suffix = Math.random().toString(36).slice(2, 8);

describe.skipIf(!enabled)('OpenBao integration', () => {
  const bao = new OpenBao();

  beforeAll(async () => {
    const health = await bao.sys.health();
    expect(health.initialized).toBe(true);
    expect(health.sealed).toBe(false);
  });

  it('sys: seal status, mounts, policies', async () => {
    expect((await bao.sys.sealStatus()).sealed).toBe(false);
    const mounts = await bao.sys.mounts.list();
    expect(Object.keys(mounts)).toContain('sys/');

    const name = `pol-${suffix}`;
    await bao.sys.policies.acl.write(name, 'path "secret/data/*" { capabilities = ["read"] }');
    expect(await bao.sys.policies.acl.list()).toContain(name);
    expect(await bao.sys.policies.acl.read(name)).toContain('secret/data/*');
    await bao.sys.policies.acl.delete(name);
  });

  it('kv v2 round trip', async () => {
    const mount = `kv2-${suffix}`;
    await bao.sys.mounts.enable(mount, { type: 'kv', options: { version: '2' } });
    // kv-v2 upgrade happens asynchronously right after mounting
    const kv = bao.kv2(mount);
    for (let i = 0; i < 20; i++) {
      try {
        await kv.readConfig();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const v1 = await kv.write('app/db', { user: 'a', password: 'p1' }, { cas: 0 });
    expect(v1.version).toBe(1);
    await expect(kv.write('app/db', { user: 'a' }, { cas: 0 })).rejects.toBeInstanceOf(OpenBaoError);

    await kv.patch('app/db', { password: 'p2' });
    expect(await kv.get('app/db')).toEqual({ user: 'a', password: 'p2' });
    expect((await kv.read('app/db', { version: 1 })).data).toEqual({ user: 'a', password: 'p1' });

    expect(await kv.list()).toEqual(['app/']);
    expect(await kv.list('app')).toEqual(['db']);
    expect(await kv.list('nope')).toEqual([]);

    const meta = await kv.readMetadata('app/db');
    expect(meta.current_version).toBe(2);

    await kv.delete('app/db');
    await expect(kv.get('app/db')).rejects.toMatchObject({ status: 404 });
    await kv.undelete('app/db', [2]);
    expect(await kv.get('app/db')).toEqual({ user: 'a', password: 'p2' });
    await kv.deleteMetadata('app/db');

    await bao.sys.mounts.disable(mount);
  });

  it('transit encrypt/decrypt/sign', async () => {
    const mount = `transit-${suffix}`;
    await bao.sys.mounts.enable(mount, { type: 'transit' });
    const t = bao.transit(mount);
    await t.createKey('aes');
    const ct = await t.encrypt('aes', 'hello world');
    expect(ct).toMatch(/^(bao|vault):v1:/);
    expect(await t.decrypt('aes', ct)).toBe('hello world');

    await t.rotateKey('aes');
    const rewrapped = await t.rewrap('aes', ct);
    expect(rewrapped).toMatch(/:v2:/);

    const batch = await t.encryptBatch('aes', [{ plaintext: 'a' }, { plaintext: 'b' }]);
    const plain = await t.decryptBatch('aes', batch.map((b) => ({ ciphertext: b.ciphertext! })));
    expect(plain.map((p) => p.plaintext)).toEqual(['a', 'b']);

    await t.createKey('ed', { type: 'ed25519' });
    const sig = await t.sign('ed', 'msg');
    expect(await t.verify('ed', 'msg', sig)).toBe(true);
    expect(await t.verify('ed', 'other', sig)).toBe(false);

    await bao.sys.mounts.disable(mount);
  });

  it('approle login with wrapped secret-id', async () => {
    const mount = `approle-${suffix}`;
    await bao.sys.auth.enable(mount, { type: 'approle' });
    const approle = bao.auth.approle(mount);
    await approle.roles.write('svc', { token_policies: ['default'], token_ttl: '10m' });
    const roleId = await approle.readRoleId('svc');

    const wrap = await approle.generateWrappedSecretId('svc', '1m');
    const unwrapped = await bao.sys.wrapping.unwrap<{ secret_id: string }>(wrap.token);

    const app = bao.withToken(undefined);
    const auth = await app.auth.approle(mount).login(roleId, unwrapped.data.secret_id);
    expect(app.token).toBe(auth.client_token);
    expect(bao.token).not.toBe(auth.client_token);

    const self = await app.auth.token.lookupSelf();
    expect(self.policies).toContain('default');
    await app.auth.token.revokeSelf();
    expect(app.token).toBeUndefined();

    await bao.sys.auth.disable(mount);
  });

  it('userpass + token create/lookup', async () => {
    const mount = `up-${suffix}`;
    await bao.sys.auth.enable(mount, { type: 'userpass' });
    const up = bao.auth.userpass(mount);
    await up.users.write('alice', { password: 'pw', token_policies: ['default'] });
    expect(await up.users.list()).toEqual(['alice']);
    const auth = await up.login('alice', 'pw', { setToken: false });
    expect(auth.policies).toContain('default');

    const child = await bao.auth.token.create({ policies: ['default'], ttl: '5m' });
    const info = await bao.auth.token.lookup(child.client_token);
    expect(info.ttl).toBeGreaterThan(0);
    await bao.auth.token.revoke(child.client_token);

    await bao.sys.auth.disable(mount);
  });

  it('pki issue', async () => {
    const mount = `pki-${suffix}`;
    await bao.sys.mounts.enable(mount, { type: 'pki', config: { max_lease_ttl: '87600h' } });
    const pki = bao.pki(mount);
    await pki.generateRoot({ common_name: 'Test Root', ttl: '87600h' });
    await pki.roles.write('web', { allowed_domains: ['example.com'], allow_subdomains: true, max_ttl: '72h' });
    const cert = await pki.issue('web', { common_name: 'app.example.com', ttl: '1h', alt_names: ['www.example.com'] });
    expect(cert.certificate).toContain('BEGIN CERTIFICATE');
    expect(cert.private_key).toContain('PRIVATE KEY');
    expect(await pki.caPem()).toContain('BEGIN CERTIFICATE');
    await pki.revoke(cert.serial_number);
    await bao.sys.mounts.disable(mount);
  });

  it('sys tools and cubbyhole', async () => {
    expect(await bao.sys.tools.random(16, { format: 'hex' })).toHaveLength(32);
    expect(await bao.sys.tools.hash('abc', { algorithm: 'sha2-256', format: 'hex' })).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    await bao.cubbyhole.set('note', { a: 1 });
    expect(await bao.cubbyhole.get('note')).toEqual({ a: 1 });
    await bao.cubbyhole.delete('note');
  });
});
