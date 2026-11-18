import { OpenBao, type OpenBaoOptions } from '../../src/index.js';

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: Call) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function envelope<T>(data: T, extra: Record<string, unknown> = {}) {
  return {
    request_id: 'req',
    lease_id: '',
    renewable: false,
    lease_duration: 0,
    data,
    wrap_info: null,
    warnings: null,
    auth: null,
    ...extra,
  };
}

/** Creates a client whose fetch is served by `responder` and records every call. */
export function mockClient(responder: Responder = () => json(envelope({})), options: OpenBaoOptions = {}) {
  const calls: Call[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const raw = init.body as string | undefined;
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* keep raw */
    }
    const call: Call = { url: new URL(input), method: init.method ?? 'GET', headers, body };
    calls.push(call);
    return responder(call);
  };
  const bao = new OpenBao({ address: 'http://bao.test:8200', token: 'root', useEnv: false, fetch, retry: { minDelay: 1, maxDelay: 2 }, ...options });
  return { bao, calls };
}
