import { describe, expect, it } from 'vitest';
import { toBase64 } from '../../src/index.js';
import { envelope, json, mockClient } from './helpers.js';

describe('kv2', () => {
  it('reads, writes with cas, patches and lists', async () => {
    const { bao, calls } = mockClient((c) => {
      if (c.method === 'GET' && c.url.pathname.includes('/data/')) return json(envelope({ data: { pw: 'x' }, metadata: { version: 2 } }));
      if (c.url.searchParams.get('list')) return json(envelope({ keys: ['a', 'b/'] }));
      return json(envelope({ version: 3 }));
    });
    const kv = bao.kv2('secret');
    await expect(kv.get<{ pw: string }>('app')).resolves.toEqual({ pw: 'x' });
    await expect(kv.write('app', { pw: 'y' }, { cas: 2 })).resolves.toEqual({ version: 3 });
    await kv.patch('app', { pw: null });
    await expect(kv.list()).resolves.toEqual(['a', 'b/']);

    expect(calls[1]!.body).toEqual({ options: { cas: 2 }, data: { pw: 'y' } });
    expect(calls[2]!.method).toBe('PATCH');
    expect(calls[2]!.headers['content-type']).toBe('application/merge-patch+json');
    expect(calls[3]!.url.pathname).toBe('/v1/secret/metadata/');
  });

  it('versioned read passes the version query', async () => {
    const { bao, calls } = mockClient(() => json(envelope({ data: {}, metadata: {} })));
    await bao.kv2().read('x', { version: 4 });
    expect(calls[0]!.url.search).toBe('?version=4');
  });
});

describe('transit', () => {
  it('base64-encodes plaintext and decodes decrypted output', async () => {
    const { bao, calls } = mockClient((c) =>
      c.url.pathname.endsWith('/encrypt/k')
        ? json(envelope({ ciphertext: 'bao:v1:abc' }))
        : json(envelope({ plaintext: toBase64('héllo') })),
    );
    const t = bao.transit();
    const ct = await t.encrypt('k', 'héllo', { context: 'ctx' });
    expect(ct).toBe('bao:v1:abc');
    expect(calls[0]!.body).toEqual({ plaintext: toBase64('héllo'), context: toBase64('ctx') });
    await expect(t.decrypt('k', ct)).resolves.toBe('héllo');
  });
});

describe('auth', () => {
  it('approle login stores the token and omits the old one', async () => {
    const { bao, calls } = mockClient(() =>
      json(envelope(null, { auth: { client_token: 'new-token', lease_duration: 60, renewable: true, policies: [] } })),
    );
    const auth = await bao.auth.approle().login('rid', 'sid');
    expect(auth.client_token).toBe('new-token');
    expect(bao.token).toBe('new-token');
    expect(calls[0]!.url.pathname).toBe('/v1/auth/approle/login');
    expect(calls[0]!.headers['x-vault-token']).toBeUndefined();
    expect(calls[0]!.body).toEqual({ role_id: 'rid', secret_id: 'sid' });
  });

  it('login with setToken:false leaves the client untouched', async () => {
    const { bao } = mockClient(() => json(envelope(null, { auth: { client_token: 't2' } })));
    await bao.auth.userpass('people').login('alice', 'pw', { setToken: false });
    expect(bao.token).toBe('root');
  });

  it('custom mount paths are respected', async () => {
    const { bao, calls } = mockClient(() => json(envelope(null, { auth: { client_token: 't' } })));
    await bao.auth.jwt('github-actions').login('ey...', 'ci');
    expect(calls[0]!.url.pathname).toBe('/v1/auth/github-actions/login');
  });

  it('wrapped secret-id returns wrap info', async () => {
    const { bao, calls } = mockClient(() => json(envelope(null, { wrap_info: { token: 'hvs.wrap', ttl: 300 } })));
    const wrap = await bao.auth.approle().generateWrappedSecretId('app', '5m');
    expect(wrap.token).toBe('hvs.wrap');
    expect(calls[0]!.headers['x-vault-wrap-ttl']).toBe('5m');
  });
});

describe('sys', () => {
  it('health accepts non-200 status codes', async () => {
    const { bao, calls } = mockClient(() => json({ initialized: true, sealed: true, standby: true }, 503));
    const h = await bao.sys.health({ standbyok: true });
    expect(h.sealed).toBe(true);
    expect(calls[0]!.url.search).toBe('?standbyok=true');
    expect(calls[0]!.headers['x-vault-token']).toBeUndefined();
  });

  it('policies write uses PUT', async () => {
    const { bao, calls } = mockClient(() => new Response(null, { status: 204 }));
    await bao.sys.policies.acl.write('app', 'path "secret/*" { capabilities = ["read"] }');
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.url.pathname).toBe('/v1/sys/policies/acl/app');
  });

  it('mounts list unwraps data', async () => {
    const { bao } = mockClient(() => json(envelope({ 'secret/': { type: 'kv' } })));
    await expect(bao.sys.mounts.list()).resolves.toEqual({ 'secret/': { type: 'kv' } });
  });
});

describe('resource helper', () => {
  it('exists() maps 404 to false', async () => {
    const { bao } = mockClient(() => json({ errors: [] }, 404));
    await expect(bao.pki().roles.exists('web')).resolves.toBe(false);
  });
});
