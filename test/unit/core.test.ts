import { describe, expect, it } from 'vitest';
import { OpenBaoConnectionError, OpenBaoError, isNotFound } from '../../src/index.js';
import { envelope, json, mockClient } from './helpers.js';

describe('request basics', () => {
  it('sends token, namespace and request headers', async () => {
    const { bao, calls } = mockClient(undefined, { namespace: '/team-a/' });
    await bao.read('secret/data/foo');
    const [c] = calls;
    expect(c!.url.href).toBe('http://bao.test:8200/v1/secret/data/foo');
    expect(c!.method).toBe('GET');
    expect(c!.headers['x-vault-token']).toBe('root');
    expect(c!.headers['x-vault-namespace']).toBe('team-a');
    expect(c!.headers['x-vault-request']).toBe('true');
  });

  it('allows per-call token/namespace overrides and wrapping', async () => {
    const { bao, calls } = mockClient(undefined, { namespace: 'a' });
    await bao.write('x/y', { a: 1 }, { token: null, namespace: null, wrapTTL: '30s' });
    const h = calls[0]!.headers;
    expect(h['x-vault-token']).toBeUndefined();
    expect(h['x-vault-namespace']).toBeUndefined();
    expect(h['x-vault-wrap-ttl']).toBe('30s');
    expect(h['content-type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({ a: 1 });
  });

  it('returns undefined for 204', async () => {
    const { bao } = mockClient(() => new Response(null, { status: 204 }));
    await expect(bao.write('sys/policies/acl/x', {})).resolves.toBeUndefined();
  });

  it('decodes OpenBao errors', async () => {
    const { bao } = mockClient(() => json({ errors: ['permission denied'] }, 403));
    const err = await bao.read('secret/data/nope').catch((e) => e);
    expect(err).toBeInstanceOf(OpenBaoError);
    expect(err.status).toBe(403);
    expect(err.isForbidden).toBe(true);
    expect(err.errors).toEqual(['permission denied']);
    expect(err.message).toContain('permission denied');
  });

  it('isNotFound helper', async () => {
    const { bao } = mockClient(() => json({ errors: [] }, 404));
    const err = await bao.read('kv/missing').catch((e) => e);
    expect(isNotFound(err)).toBe(true);
  });

  it('list uses GET ?list=true and maps 404 to empty', async () => {
    const { bao, calls } = mockClient(() => json({ errors: [] }, 404));
    await expect(bao.list('secret/metadata/', { limit: 5 })).resolves.toEqual({ keys: [] });
    expect(calls[0]!.url.searchParams.get('list')).toBe('true');
    expect(calls[0]!.url.searchParams.get('limit')).toBe('5');
  });

  it('scan uses the SCAN verb', async () => {
    const { bao, calls } = mockClient(() => json(envelope({ keys: ['a', 'b/c'] })));
    await expect(bao.scan('secret/metadata/')).resolves.toEqual({ keys: ['a', 'b/c'] });
    expect(calls[0]!.method).toBe('SCAN');
  });

  it('URL-encodes path segments but keeps slashes', async () => {
    const { bao, calls } = mockClient();
    await bao.kv2('my secrets').read('team a/db#1');
    expect(calls[0]!.url.pathname).toBe('/v1/my%20secrets/data/team%20a/db%231');
  });
});

describe('retries and timeouts', () => {
  it('retries retryable status codes', async () => {
    let n = 0;
    const { bao, calls } = mockClient(() => (++n < 3 ? json({ errors: ['standby'] }, 503) : json(envelope({ ok: true }))));
    const res = await bao.read('x');
    expect(res.data).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it('gives up after max retries', async () => {
    const { bao, calls } = mockClient(() => json({ errors: ['nope'] }, 429), { retry: { retries: 1, minDelay: 1 } });
    await expect(bao.read('x')).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(2);
  });

  it('does not retry network errors for POST', async () => {
    let n = 0;
    const { bao } = mockClient(() => {
      n++;
      throw new TypeError('fetch failed');
    });
    await expect(bao.write('x', {})).rejects.toBeInstanceOf(OpenBaoConnectionError);
    expect(n).toBe(1);
  });

  it('times out', async () => {
    const { bao } = mockClient(
      (c) =>
        new Promise((_, reject) => {
          // emulate fetch honoring the abort signal
          setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 50);
          void c;
        }),
      { timeout: 10, retry: false },
    );
    const err = await bao.read('slow').catch((e) => e);
    expect(err).toBeInstanceOf(OpenBaoConnectionError);
    expect(err.timedOut).toBe(true);
  });
});

describe('clients', () => {
  it('withNamespace / withToken produce independent clients', async () => {
    const { bao, calls } = mockClient();
    const child = bao.withNamespace('ns1').withToken('child-token');
    child.token = 'changed';
    await child.read('a');
    await bao.read('b');
    expect(calls[0]!.headers['x-vault-namespace']).toBe('ns1');
    expect(calls[0]!.headers['x-vault-token']).toBe('changed');
    expect(calls[1]!.headers['x-vault-namespace']).toBeUndefined();
    expect(calls[1]!.headers['x-vault-token']).toBe('root');
  });
});
