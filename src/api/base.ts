import type { OpenBaoCore } from '../core.js';
import { OpenBaoError } from '../errors.js';
import type { ApiResponse, AuthInfo, CallOptions, ListOptions, LoginOptions, Query } from '../types.js';
import { compact as compactObj, joinPath, trimSlashes } from '../utils.js';

/**
 * Many `sys/*` endpoints return their payload both at the top level and in
 * `data`; others only at the top level. This picks whichever is present.
 */
export function unwrapData<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'data' in res && (res as { data: unknown }).data != null) {
    return (res as { data: T }).data;
  }
  return res as T;
}

/** Base for engines and auth methods that live at a configurable mount path. */
export abstract class MountedApi {
  /** Mount path without surrounding slashes, e.g. `secret` or `auth/approle`. */
  readonly mount: string;

  constructor(
    protected readonly client: OpenBaoCore,
    mount: string,
  ) {
    this.mount = trimSlashes(mount);
  }

  /** Builds `<mount>/<...segments>` with each segment URL-encoded. */
  protected path(...segments: Array<string | number | undefined>): string {
    return joinPath(this.mount, ...segments);
  }
}

/** Base for auth methods: performs a login and (by default) stores the token on the client. */
export abstract class AuthMethodApi extends MountedApi {
  constructor(client: OpenBaoCore, mount: string) {
    super(client, `auth/${trimSlashes(mount).replace(/^auth\//, '')}`);
  }

  /** @internal */
  protected async doLogin(path: string, body: Record<string, unknown>, opts: LoginOptions = {}): Promise<AuthInfo> {
    const { setToken = true, ...call } = opts;
    const res = await this.client.request<ApiResponse<unknown>>({
      ...call,
      method: 'POST',
      path,
      body,
      token: null,
    });
    if (!res?.auth) {
      throw new Error(`Login at ${path} returned no auth block${res?.warnings?.length ? `: ${res.warnings.join('; ')}` : ''}`);
    }
    if (setToken) this.client.token = res.auth.client_token;
    return res.auth;
  }
}

/**
 * A named collection of configuration objects under one base path — e.g.
 * `pki/roles/:name`, `database/static-roles/:name`, `auth/approle/role/:name`.
 */
export class Resource<TRead = Record<string, unknown>, TWrite extends object = Partial<TRead> & Record<string, unknown>> {
  constructor(
    protected readonly client: OpenBaoCore,
    /** Base path of the collection, e.g. `pki/roles`. */
    readonly basePath: string,
  ) {}

  /** Lists item names. Returns `[]` when the collection is empty. */
  async list(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${trimSlashes(this.basePath)}/`, opts)).keys;
  }

  /** Reads an item. Throws `OpenBaoError` (404) when it does not exist. */
  async read(name: string, opts?: CallOptions): Promise<TRead> {
    return unwrapData<TRead>(await this.client.read<TRead>(joinPath(this.basePath, name), opts));
  }

  /** Creates or updates an item. */
  async write(name: string, data: TWrite, opts?: CallOptions): Promise<void> {
    await this.client.write(joinPath(this.basePath, name), compactObj(data), opts);
  }

  async delete(name: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath(this.basePath, name), opts);
  }

  /** `true` when the item exists. */
  async exists(name: string, opts?: CallOptions): Promise<boolean> {
    try {
      await this.read(name, opts);
      return true;
    } catch (err) {
      if (err instanceof OpenBaoError && err.status === 404) return false;
      throw err;
    }
  }
}

/** POSTs and returns `data` of the response, failing loudly on an empty (204) body. */
export async function postData<T>(client: OpenBaoCore, path: string, body: object, opts?: CallOptions): Promise<T> {
  const res = await client.write<T>(path, body, opts);
  if (res === undefined) throw new Error(`POST /v1/${path} returned no content`);
  return unwrapData<T>(res);
}

/** GETs and returns `data` of the response. */
export async function getData<T>(client: OpenBaoCore, path: string, opts?: CallOptions & { query?: Query }): Promise<T> {
  return unwrapData<T>(await client.read<T>(path, opts));
}
