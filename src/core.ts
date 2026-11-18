import { OpenBaoConnectionError, OpenBaoError } from './errors.js';
import type { ApiResponse, CallOptions, HttpMethod, ListData, ListOptions, Query } from './types.js';
import { buildQuery, readEnv, sleep, trimSlashes } from './utils.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RetryOptions {
  /** Maximum retry attempts after the first try. @default 2 */
  retries?: number;
  /** Initial backoff in milliseconds (doubled each attempt, with jitter). @default 250 */
  minDelay?: number;
  /** Upper bound for backoff in milliseconds. @default 5000 */
  maxDelay?: number;
  /**
   * Status codes retried for every method. 412 is returned by performance
   * standbys that have not caught up yet; 429/503 mean the request was rejected
   * before processing. @default [412, 429, 503]
   */
  statusCodes?: number[];
}

export interface OpenBaoOptions {
  /** Server address, e.g. `https://bao.example.com:8200`. Falls back to `BAO_ADDR` / `VAULT_ADDR`, then `http://127.0.0.1:8200`. */
  address?: string;
  /** Client token. Falls back to `BAO_TOKEN` / `VAULT_TOKEN`. */
  token?: string;
  /** Namespace sent as `X-Vault-Namespace`. Falls back to `BAO_NAMESPACE` / `VAULT_NAMESPACE`. */
  namespace?: string;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds (0 disables). @default 60000 */
  timeout?: number;
  /** Retry policy, or `false` to disable retries. */
  retry?: RetryOptions | false;
  /** Custom fetch implementation (defaults to global `fetch`). */
  fetch?: FetchLike;
  /**
   * Extra `RequestInit` fields merged into every request. Use this to pass an
   * undici `dispatcher` for custom TLS (CA bundle, client certificates):
   *
   * ```ts
   * import { Agent } from 'undici';
   * new OpenBao({ requestInit: { dispatcher: new Agent({ connect: { ca } }) } });
   * ```
   */
  requestInit?: RequestInit & Record<string, unknown>;
  /** Send `X-Vault-Request: true` (required by proxies with `require_request_header`). @default true */
  requestHeader?: boolean;
  /** Read address/token/namespace from environment variables when not given. @default true */
  useEnv?: boolean;
}

export interface RequestOptions extends CallOptions {
  method: HttpMethod;
  /** API path relative to `/v1/`, e.g. `secret/data/foo`. */
  path: string;
  query?: Query;
  body?: unknown;
  /** Override the request content type (defaults to `application/json` when a body is present). */
  contentType?: string;
  /** Extra non-2xx statuses that should be treated as success (e.g. for `sys/health`). */
  acceptStatus?: number[];
  /** How to decode the response body. @default 'json' */
  responseType?: 'json' | 'text';
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  retries: 2,
  minDelay: 250,
  maxDelay: 5000,
  statusCodes: [412, 429, 503],
};

const IDEMPOTENT = new Set<HttpMethod>(['GET', 'HEAD', 'LIST', 'SCAN', 'PUT', 'DELETE']);

interface ResolvedConfig {
  address: string;
  token: string | undefined;
  namespace: string | undefined;
  headers: Record<string, string>;
  timeout: number;
  retry: Required<RetryOptions> | false;
  fetch: FetchLike;
  requestInit: (RequestInit & Record<string, unknown>) | undefined;
  requestHeader: boolean;
}

/**
 * Low-level HTTP client. Handles auth headers, namespaces, response wrapping,
 * timeouts, retries and error decoding. {@link OpenBao} builds the typed API on top.
 */
export class OpenBaoCore {
  /** @internal */
  protected readonly config: ResolvedConfig;

  constructor(options: OpenBaoOptions = {}) {
    const useEnv = options.useEnv ?? true;
    const env = (...names: string[]) => (useEnv ? readEnv(...names) : undefined);
    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error('No fetch implementation available; pass `fetch` in OpenBao options (Node >= 18 has one built in).');
    }
    this.config = {
      address: (options.address ?? env('BAO_ADDR', 'VAULT_ADDR') ?? 'http://127.0.0.1:8200').replace(/\/+$/, ''),
      token: options.token ?? env('BAO_TOKEN', 'VAULT_TOKEN'),
      namespace: options.namespace ?? env('BAO_NAMESPACE', 'VAULT_NAMESPACE'),
      headers: { ...options.headers },
      timeout: options.timeout ?? 60_000,
      retry: options.retry === false ? false : { ...DEFAULT_RETRY, ...options.retry },
      fetch: fetchImpl,
      requestInit: options.requestInit,
      requestHeader: options.requestHeader ?? true,
    };
  }

  /** Base server address (without `/v1`). */
  get address(): string {
    return this.config.address;
  }

  /** Current client token. Login helpers update this automatically. */
  get token(): string | undefined {
    return this.config.token;
  }

  set token(value: string | undefined) {
    this.config.token = value;
  }

  /** Current namespace. */
  get namespace(): string | undefined {
    return this.config.namespace;
  }

  set namespace(value: string | undefined) {
    this.config.namespace = value;
  }

  /** Sends a request and returns the decoded body (`undefined` for 204 No Content). */
  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const path = opts.path.replace(/^\/+/, '');
    const url = `${this.config.address}/v1/${path}${buildQuery(opts.query)}`;
    const headers = this.buildHeaders(opts);
    const hasBody = opts.body !== undefined;
    if (hasBody) headers['Content-Type'] = opts.contentType ?? 'application/json';
    const body = hasBody
      ? typeof opts.body === 'string' && opts.contentType && opts.contentType !== 'application/json'
        ? opts.body
        : JSON.stringify(opts.body)
      : undefined;

    const retry = this.config.retry;
    const maxAttempts = retry ? retry.retries + 1 : 1;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      const { signal, cleanup, timedOut } = this.createSignal(opts.signal);
      try {
        res = await this.config.fetch(url, {
          ...this.config.requestInit,
          method: opts.method,
          headers,
          body,
          signal,
        });
      } catch (cause) {
        cleanup();
        const canRetry = retry && attempt < maxAttempts && IDEMPOTENT.has(opts.method) && !opts.signal?.aborted;
        if (canRetry) {
          await sleep(this.backoff(attempt), opts.signal);
          continue;
        }
        throw new OpenBaoConnectionError({ method: opts.method, path, cause, timedOut: timedOut() });
      }

      try {
        const ok = res.ok || opts.acceptStatus?.includes(res.status);
        if (!ok && retry && attempt < maxAttempts && retry.statusCodes.includes(res.status)) {
          await res.body?.cancel().catch(() => undefined);
          await sleep(this.backoff(attempt, res.headers.get('retry-after')), opts.signal);
          continue;
        }
        const parsed = await this.parseBody(res, opts.responseType ?? 'json');
        if (!ok) {
          const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as { errors?: unknown; warnings?: unknown };
          throw new OpenBaoError({
            status: res.status,
            method: opts.method,
            path,
            errors: Array.isArray(obj.errors) ? obj.errors.map(String) : typeof parsed === 'string' && parsed ? [parsed] : [],
            warnings: Array.isArray(obj.warnings) ? obj.warnings.map(String) : [],
            body: parsed,
          });
        }
        return parsed as T;
      } catch (err) {
        if (err instanceof OpenBaoError) throw err;
        throw new OpenBaoConnectionError({ method: opts.method, path, cause: err, timedOut: timedOut() });
      } finally {
        cleanup();
      }
    }
  }

  // ---------------------------------------------------------------- generic logical ops

  /** `GET` a path and return the full response envelope. Throws {@link OpenBaoError} (404) when missing. */
  read<T = Record<string, unknown>>(path: string, opts: CallOptions & { query?: Query } = {}): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>({ ...opts, method: 'GET', path });
  }

  /** `POST` data to a path. Resolves to `undefined` when the server answers 204. */
  write<T = Record<string, unknown>>(
    path: string,
    data?: Record<string, unknown> | object,
    opts: CallOptions & { query?: Query } = {},
  ): Promise<ApiResponse<T> | undefined> {
    return this.request<ApiResponse<T> | undefined>({ ...opts, method: 'POST', path, body: data ?? {} });
  }

  /** JSON merge-patch a path (`PATCH` with `application/merge-patch+json`). */
  patch<T = Record<string, unknown>>(
    path: string,
    data: Record<string, unknown> | object,
    opts: CallOptions = {},
  ): Promise<ApiResponse<T> | undefined> {
    return this.request<ApiResponse<T> | undefined>({
      ...opts,
      method: 'PATCH',
      path,
      body: data,
      contentType: 'application/merge-patch+json',
    });
  }

  /** `DELETE` a path. */
  delete<T = Record<string, unknown>>(path: string, opts: CallOptions & { query?: Query } = {}): Promise<ApiResponse<T> | undefined> {
    return this.request<ApiResponse<T> | undefined>({ ...opts, method: 'DELETE', path });
  }

  /**
   * `LIST` a path. Returns `{ keys: [] }` when nothing exists (OpenBao answers 404 for empty lists).
   */
  async list<Info = unknown>(path: string, opts: CallOptions & ListOptions = {}): Promise<ListData<Info>> {
    const { after, limit, ...call } = opts;
    return this.listLike<Info>('LIST', path, { after, limit }, call);
  }

  /** Recursive `SCAN` of a path (OpenBao-specific). Returns `{ keys: [] }` when nothing exists. */
  async scan<Info = unknown>(path: string, opts: CallOptions & ListOptions = {}): Promise<ListData<Info>> {
    const { after, limit, ...call } = opts;
    return this.listLike<Info>('SCAN', path, { after, limit }, call);
  }

  // ---------------------------------------------------------------- internals

  private async listLike<Info>(
    verb: 'LIST' | 'SCAN',
    path: string,
    page: ListOptions,
    call: CallOptions,
  ): Promise<ListData<Info>> {
    try {
      // LIST is sent as `GET ?list=true` for maximum proxy compatibility; SCAN has no GET form.
      const res =
        verb === 'LIST'
          ? await this.request<ApiResponse<ListData<Info>>>({
              ...call,
              method: 'GET',
              path,
              query: { list: true, after: page.after, limit: page.limit },
            })
          : await this.request<ApiResponse<ListData<Info>>>({
              ...call,
              method: 'SCAN',
              path,
              query: { after: page.after, limit: page.limit },
            });
      return { keys: res?.data?.keys ?? [], ...(res?.data?.key_info ? { key_info: res.data.key_info } : {}) };
    } catch (err) {
      if (err instanceof OpenBaoError && err.status === 404) return { keys: [] };
      throw err;
    }
  }

  private buildHeaders(opts: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', ...this.config.headers };
    if (this.config.requestHeader) headers['X-Vault-Request'] = 'true';
    const token = opts.token === undefined ? this.config.token : opts.token;
    if (token) headers['X-Vault-Token'] = token;
    const ns = opts.namespace === undefined ? this.config.namespace : opts.namespace;
    if (ns) headers['X-Vault-Namespace'] = trimSlashes(ns);
    if (opts.wrapTTL !== undefined) headers['X-Vault-Wrap-TTL'] = String(opts.wrapTTL);
    Object.assign(headers, opts.headers);
    return headers;
  }

  private async parseBody(res: Response, type: 'json' | 'text'): Promise<unknown> {
    if (res.status === 204 || res.status === 304) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    if (type === 'text' && res.ok) return text;
    if (isJson || type === 'json') {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  private createSignal(user?: AbortSignal): { signal: AbortSignal | undefined; cleanup: () => void; timedOut: () => boolean } {
    const timeout = this.config.timeout;
    if (!timeout) return { signal: user, cleanup: () => undefined, timedOut: () => false };
    const controller = new AbortController();
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      controller.abort(new Error('timeout'));
    }, timeout);
    const onAbort = () => controller.abort(user?.reason);
    if (user) {
      if (user.aborted) controller.abort(user.reason);
      else user.addEventListener('abort', onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        user?.removeEventListener('abort', onAbort);
      },
      timedOut: () => fired,
    };
  }

  private backoff(attempt: number, retryAfter?: string | null): number {
    const retry = this.config.retry || DEFAULT_RETRY;
    const fromHeader = retryAfter ? Number(retryAfter) * 1000 : NaN;
    if (Number.isFinite(fromHeader) && fromHeader >= 0) return Math.min(fromHeader, retry.maxDelay);
    const base = Math.min(retry.maxDelay, retry.minDelay * 2 ** (attempt - 1));
    return base / 2 + Math.random() * (base / 2);
  }
}
