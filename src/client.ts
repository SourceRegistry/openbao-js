import { Auth } from './api/auth.js';
import { Database } from './api/secrets/database.js';
import { Cubbyhole, KvV1, KvV2 } from './api/secrets/kv.js';
import { Identity, Ssh, Totp } from './api/secrets/misc.js';
import { Pki } from './api/secrets/pki.js';
import { Transit } from './api/secrets/transit.js';
import { Sys } from './api/sys.js';
import { OpenBaoCore, type OpenBaoOptions } from './core.js';

/**
 * OpenBao API client.
 *
 * ```ts
 * const bao = new OpenBao({ address: 'https://bao.example.com', token: process.env.BAO_TOKEN });
 *
 * await bao.kv2('secret').write('app/db', { password: 's3cr3t' });
 * const { password } = await bao.kv2('secret').get('app/db');
 *
 * const ct = await bao.transit().encrypt('my-key', 'hello');
 * ```
 *
 * Mount-based engines are created by factory methods that take the mount path
 * (with sensible defaults), so any number of mounts can be used side by side.
 */
export class OpenBao extends OpenBaoCore {
  private _sys?: Sys;
  private _auth?: Auth;
  private _identity?: Identity;
  private _cubbyhole?: Cubbyhole;

  constructor(options: OpenBaoOptions = {}) {
    super(options);
  }

  /** System backend: health, seal, mounts, policies, leases, wrapping, namespaces, ... */
  get sys(): Sys {
    return (this._sys ??= new Sys(this));
  }

  /** Auth methods: `auth.token`, `auth.approle()`, `auth.userpass()`, `auth.jwt()`, ... */
  get auth(): Auth {
    return (this._auth ??= new Auth(this));
  }

  /** Identity secrets engine: entities, groups, aliases, OIDC identity tokens. */
  get identity(): Identity {
    return (this._identity ??= new Identity(this));
  }

  /** The token's private cubbyhole. */
  get cubbyhole(): Cubbyhole {
    return (this._cubbyhole ??= new Cubbyhole(this));
  }

  /** KV version 2 engine mounted at `mount` (default `secret`). */
  kv2(mount = 'secret'): KvV2 {
    return new KvV2(this, mount);
  }

  /** Alias of {@link kv2} — KV v2 is the default KV engine. */
  kv(mount = 'secret'): KvV2 {
    return this.kv2(mount);
  }

  /** KV version 1 engine mounted at `mount` (default `kv`). */
  kv1(mount = 'kv'): KvV1 {
    return new KvV1(this, mount);
  }

  /** Transit engine mounted at `mount` (default `transit`). */
  transit(mount = 'transit'): Transit {
    return new Transit(this, mount);
  }

  /** PKI engine mounted at `mount` (default `pki`). */
  pki(mount = 'pki'): Pki {
    return new Pki(this, mount);
  }

  /** Database engine mounted at `mount` (default `database`). */
  database(mount = 'database'): Database {
    return new Database(this, mount);
  }

  /** TOTP engine mounted at `mount` (default `totp`). */
  totp(mount = 'totp'): Totp {
    return new Totp(this, mount);
  }

  /** SSH engine mounted at `mount` (default `ssh`). */
  ssh(mount = 'ssh'): Ssh {
    return new Ssh(this, mount);
  }

  /**
   * Returns an independent client bound to another namespace. Token changes on
   * the returned client do not affect this one.
   */
  withNamespace(namespace: string | undefined): OpenBao {
    return this.clone({ namespace });
  }

  /** Returns an independent client that authenticates with `token`. */
  withToken(token: string | undefined): OpenBao {
    return this.clone({ token });
  }

  /** Returns an independent copy of this client with some settings overridden. */
  clone(overrides: Partial<Pick<OpenBaoOptions, 'token' | 'namespace' | 'headers' | 'timeout' | 'retry'>> = {}): OpenBao {
    const c = this.config;
    const has = (k: keyof typeof overrides) => Object.prototype.hasOwnProperty.call(overrides, k);
    return new OpenBao({
      address: c.address,
      token: has('token') ? overrides.token : c.token,
      namespace: has('namespace') ? overrides.namespace : c.namespace,
      headers: { ...c.headers, ...overrides.headers },
      timeout: overrides.timeout ?? c.timeout,
      retry: has('retry') ? overrides.retry : c.retry,
      fetch: c.fetch,
      requestInit: c.requestInit,
      requestHeader: c.requestHeader,
      useEnv: false,
    });
  }
}
