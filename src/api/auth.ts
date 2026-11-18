import type { OpenBaoCore } from '../core.js';
import type { ApiResponse, AuthInfo, CallOptions, Duration, ListOptions, LoginOptions, TokenFields, WrapInfo } from '../types.js';
import { compact } from '../utils.js';
import { AuthMethodApi, MountedApi, Resource, getData, postData } from './base.js';

// ================================================================== Token

export interface CreateTokenOptions {
  id?: string;
  role_name?: string;
  policies?: string[];
  meta?: Record<string, string>;
  no_parent?: boolean;
  no_default_policy?: boolean;
  renewable?: boolean;
  ttl?: Duration;
  type?: 'service' | 'batch';
  explicit_max_ttl?: Duration;
  display_name?: string;
  num_uses?: number;
  period?: Duration;
  entity_alias?: string;
}

export interface TokenLookup {
  accessor: string;
  creation_time: number;
  creation_ttl: number;
  display_name: string;
  entity_id: string;
  expire_time: string | null;
  explicit_max_ttl: number;
  id: string;
  issue_time?: string;
  meta: Record<string, string> | null;
  num_uses: number;
  orphan: boolean;
  path: string;
  policies: string[];
  identity_policies?: string[];
  renewable: boolean;
  ttl: number;
  type: 'service' | 'batch';
  [key: string]: unknown;
}

export interface TokenRole {
  allowed_policies?: string[];
  disallowed_policies?: string[];
  allowed_policies_glob?: string[];
  disallowed_policies_glob?: string[];
  orphan?: boolean;
  renewable?: boolean;
  path_suffix?: string;
  allowed_entity_aliases?: string[];
  token_period?: Duration;
  [key: string]: unknown;
}

/** Token auth method (`auth/token`). Always mounted, cannot be moved. */
export class TokenAuth extends MountedApi {
  /** Token roles (`auth/token/roles/:name`). */
  readonly roles: Resource<TokenRole & TokenFields, TokenRole & TokenFields>;

  constructor(client: OpenBaoCore) {
    super(client, 'auth/token');
    this.roles = new Resource(client, this.path('roles'));
  }

  /**
   * Creates a token. Does **not** change the client's token — use
   * `bao.withToken(auth.client_token)` to act as it.
   */
  async create(options: CreateTokenOptions = {}, opts?: CallOptions): Promise<AuthInfo> {
    const { role_name, ...body } = options;
    return this.authOf(await this.client.write(this.path('create', role_name), compact(body), opts));
  }

  /** Creates an orphan token (no parent). */
  async createOrphan(options: Omit<CreateTokenOptions, 'role_name' | 'no_parent'> = {}, opts?: CallOptions): Promise<AuthInfo> {
    return this.authOf(await this.client.write(this.path('create-orphan'), compact(options), opts));
  }

  /** Looks up the client's own token. */
  lookupSelf(opts?: CallOptions): Promise<TokenLookup> {
    return getData(this.client, this.path('lookup-self'), opts);
  }

  lookup(token: string, opts?: CallOptions): Promise<TokenLookup> {
    return postData(this.client, this.path('lookup'), { token }, opts);
  }

  lookupAccessor(accessor: string, opts?: CallOptions): Promise<TokenLookup> {
    return postData(this.client, this.path('lookup-accessor'), { accessor }, opts);
  }

  /** Renews the client's own token. */
  async renewSelf(increment?: Duration, opts?: CallOptions): Promise<AuthInfo> {
    return this.authOf(await this.client.write(this.path('renew-self'), compact({ increment }), opts));
  }

  async renew(token: string, increment?: Duration, opts?: CallOptions): Promise<AuthInfo> {
    return this.authOf(await this.client.write(this.path('renew'), compact({ token, increment }), opts));
  }

  async renewAccessor(accessor: string, increment?: Duration, opts?: CallOptions): Promise<AuthInfo> {
    return this.authOf(await this.client.write(this.path('renew-accessor'), compact({ accessor, increment }), opts));
  }

  /** Revokes the client's own token and clears it from the client. */
  async revokeSelf(opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('revoke-self'), {}, opts);
    if (opts?.token === undefined) this.client.token = undefined;
  }

  async revoke(token: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('revoke'), { token }, opts);
  }

  async revokeAccessor(accessor: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('revoke-accessor'), { accessor }, opts);
  }

  /** Revokes a token but leaves its children as orphans. Requires `sudo`. */
  async revokeOrphan(token: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('revoke-orphan'), { token }, opts);
  }

  /** Lists token accessors. Requires `sudo`. */
  async listAccessors(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('accessors')}/`, opts)).keys;
  }

  async tidy(opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('tidy'), {}, opts);
  }

  /**
   * Keeps the client's token alive by renewing it at ~2/3 of its TTL.
   * Returns a handle with `stop()`. Timers are `unref`'d so they never keep a
   * Node.js process alive. Stops automatically when the token is not renewable
   * or reaches its max TTL.
   */
  keepAlive(options: { increment?: Duration; onRenew?: (auth: AuthInfo) => void; onError?: (err: unknown) => void } = {}): { stop: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = (ttlSeconds: number) => {
      if (stopped || ttlSeconds <= 0) return;
      timer = setTimeout(tick, Math.max(1, ttlSeconds * (2 / 3)) * 1000);
      (timer as { unref?: () => void }).unref?.();
    };
    const tick = async () => {
      try {
        const auth = await this.renewSelf(options.increment);
        options.onRenew?.(auth);
        if (auth.renewable) schedule(auth.lease_duration);
      } catch (err) {
        options.onError?.(err);
      }
    };
    this.lookupSelf()
      .then((info) => {
        if (info.renewable) schedule(info.ttl);
      })
      .catch((err) => options.onError?.(err));
    return {
      stop: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  private authOf(res: ApiResponse<unknown> | undefined): AuthInfo {
    if (!res?.auth) throw new Error('Token endpoint returned no auth block');
    return res.auth;
  }
}

// ================================================================== AppRole

export interface AppRoleRole extends TokenFields {
  bind_secret_id?: boolean;
  secret_id_bound_cidrs?: string[];
  secret_id_num_uses?: number;
  secret_id_ttl?: Duration;
  local_secret_ids?: boolean;
  [key: string]: unknown;
}

export interface SecretIdOptions {
  metadata?: Record<string, string>;
  cidr_list?: string[];
  token_bound_cidrs?: string[];
  num_uses?: number;
  ttl?: Duration;
}

export interface GeneratedSecretId {
  secret_id: string;
  secret_id_accessor: string;
  secret_id_ttl: number;
  secret_id_num_uses: number;
}

/** AppRole auth method — machine authentication with `role_id` + `secret_id`. */
export class AppRoleAuth extends AuthMethodApi {
  /** Role definitions (`auth/<mount>/role/:name`). */
  readonly roles: Resource<AppRoleRole, AppRoleRole>;

  constructor(client: OpenBaoCore, mount = 'approle') {
    super(client, mount);
    this.roles = new Resource(client, this.path('role'));
  }

  /** Logs in. The returned token is stored on the client unless `setToken: false`. */
  login(roleId: string, secretId?: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login'), compact({ role_id: roleId, secret_id: secretId }), opts);
  }

  async readRoleId(role: string, opts?: CallOptions): Promise<string> {
    return (await getData<{ role_id: string }>(this.client, this.path('role', role, 'role-id'), opts)).role_id;
  }

  async setRoleId(role: string, roleId: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('role', role, 'role-id'), { role_id: roleId }, opts);
  }

  /** Generates a new secret-id. */
  generateSecretId(role: string, options: SecretIdOptions = {}, opts?: CallOptions): Promise<GeneratedSecretId> {
    return postData(this.client, this.path('role', role, 'secret-id'), this.secretIdBody(options), opts);
  }

  /**
   * Generates a secret-id wrapped in a single-use response-wrapping token —
   * the recommended way to hand secret-ids to workloads.
   */
  async generateWrappedSecretId(role: string, wrapTTL: Duration = '5m', options: SecretIdOptions = {}, opts?: Omit<CallOptions, 'wrapTTL'>): Promise<WrapInfo> {
    const res = await this.client.write(this.path('role', role, 'secret-id'), this.secretIdBody(options), { ...opts, wrapTTL });
    if (!res?.wrap_info) throw new Error('Expected a wrapped response');
    return res.wrap_info;
  }

  /** Lists secret-id accessors for a role. */
  async listSecretIdAccessors(role: string, opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('role', role, 'secret-id')}/`, opts)).keys;
  }

  async lookupSecretId(role: string, secretId: string, opts?: CallOptions): Promise<Record<string, unknown> | undefined> {
    return (await this.client.write(this.path('role', role, 'secret-id', 'lookup'), { secret_id: secretId }, opts))?.data;
  }

  async destroySecretId(role: string, secretId: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('role', role, 'secret-id', 'destroy'), { secret_id: secretId }, opts);
  }

  async lookupSecretIdAccessor(role: string, accessor: string, opts?: CallOptions): Promise<Record<string, unknown> | undefined> {
    return (await this.client.write(this.path('role', role, 'secret-id-accessor', 'lookup'), { secret_id_accessor: accessor }, opts))?.data;
  }

  async destroySecretIdAccessor(role: string, accessor: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('role', role, 'secret-id-accessor', 'destroy'), { secret_id_accessor: accessor }, opts);
  }

  async tidySecretIds(opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('tidy', 'secret-id'), {}, opts);
  }

  private secretIdBody(o: SecretIdOptions) {
    return compact({ ...o, metadata: o.metadata ? JSON.stringify(o.metadata) : undefined });
  }
}

// ================================================================== Userpass

export interface UserpassUser extends TokenFields {
  password?: string;
  [key: string]: unknown;
}

/** Username & password auth method. */
export class UserpassAuth extends AuthMethodApi {
  readonly users: Resource<UserpassUser, UserpassUser>;

  constructor(client: OpenBaoCore, mount = 'userpass') {
    super(client, mount);
    this.users = new Resource(client, this.path('users'));
  }

  login(username: string, password: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login', username), { password }, opts);
  }

  async setPassword(username: string, password: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('users', username, 'password'), { password }, opts);
  }

  async setPolicies(username: string, policies: string[], opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('users', username, 'policies'), { token_policies: policies }, opts);
  }
}

// ================================================================== LDAP

/** LDAP auth method. */
export class LdapAuth extends AuthMethodApi {
  readonly users: Resource<{ policies?: string[]; groups?: string[] }, { policies?: string[]; groups?: string[] }>;
  readonly groups: Resource<{ policies?: string[] }, { policies?: string[] }>;

  constructor(client: OpenBaoCore, mount = 'ldap') {
    super(client, mount);
    this.users = new Resource(client, this.path('users'));
    this.groups = new Resource(client, this.path('groups'));
  }

  login(username: string, password: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login', username), { password }, opts);
  }

  readConfig(opts?: CallOptions): Promise<Record<string, unknown>> {
    return getData(this.client, this.path('config'), opts);
  }

  async writeConfig(config: Record<string, unknown>, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('config'), compact(config), opts);
  }
}

// ================================================================== JWT / OIDC

export interface JwtConfig {
  oidc_discovery_url?: string;
  oidc_discovery_ca_pem?: string;
  oidc_client_id?: string;
  oidc_client_secret?: string;
  oidc_response_mode?: 'query' | 'form_post';
  oidc_response_types?: string[];
  jwks_url?: string;
  jwks_ca_pem?: string;
  jwt_validation_pubkeys?: string[];
  bound_issuer?: string;
  jwt_supported_algs?: string[];
  default_role?: string;
  provider_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JwtRole extends TokenFields {
  role_type?: 'jwt' | 'oidc';
  user_claim: string;
  bound_audiences?: string[];
  bound_subject?: string;
  bound_claims?: Record<string, string | string[]>;
  bound_claims_type?: 'string' | 'glob';
  groups_claim?: string;
  claim_mappings?: Record<string, string>;
  allowed_redirect_uris?: string[];
  oidc_scopes?: string[];
  verbose_oidc_logging?: boolean;
  [key: string]: unknown;
}

/** JWT / OIDC auth method. The same class serves `jwt` and `oidc` mounts. */
export class JwtAuth extends AuthMethodApi {
  readonly roles: Resource<JwtRole, Partial<JwtRole>>;

  constructor(client: OpenBaoCore, mount = 'jwt') {
    super(client, mount);
    this.roles = new Resource(client, this.path('role'));
  }

  /** Logs in with a signed JWT (e.g. a GitHub Actions / Kubernetes / CI token). */
  login(jwt: string, role?: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login'), compact({ jwt, role }), opts);
  }

  readConfig(opts?: CallOptions): Promise<JwtConfig> {
    return getData(this.client, this.path('config'), opts);
  }

  async writeConfig(config: JwtConfig, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('config'), compact(config), opts);
  }

  /** Step 1 of the OIDC browser flow: obtain the provider authorization URL. */
  async oidcAuthUrl(redirectUri: string, options: { role?: string; client_nonce?: string } & CallOptions = {}): Promise<string> {
    const { role, client_nonce, ...opts } = options;
    const res = await postData<{ auth_url: string }>(this.client, this.path('oidc', 'auth_url'), compact({ role, redirect_uri: redirectUri, client_nonce }), { token: null, ...opts });
    return res.auth_url;
  }

  /** Step 2 of the OIDC browser flow: exchange the callback parameters for a token. */
  async oidcCallback(params: { state: string; code: string; nonce?: string; client_nonce?: string }, opts: LoginOptions = {}): Promise<AuthInfo> {
    const { setToken = true, ...call } = opts;
    const res = await this.client.request<ApiResponse<unknown>>({ ...call, method: 'GET', path: this.path('oidc', 'callback'), query: params, token: null });
    if (!res?.auth) throw new Error('OIDC callback returned no auth block');
    if (setToken) this.client.token = res.auth.client_token;
    return res.auth;
  }
}

// ================================================================== Kubernetes

export interface KubernetesRole extends TokenFields {
  bound_service_account_names: string[];
  bound_service_account_namespaces: string[];
  audience?: string;
  alias_name_source?: 'serviceaccount_uid' | 'serviceaccount_name';
  [key: string]: unknown;
}

/** Kubernetes auth method. */
export class KubernetesAuth extends AuthMethodApi {
  readonly roles: Resource<KubernetesRole, Partial<KubernetesRole>>;

  constructor(client: OpenBaoCore, mount = 'kubernetes') {
    super(client, mount);
    this.roles = new Resource(client, this.path('role'));
  }

  login(role: string, jwt: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login'), { role, jwt }, opts);
  }

  /**
   * Logs in with the pod's projected service-account token (Node.js only).
   * @param tokenPath defaults to `/var/run/secrets/kubernetes.io/serviceaccount/token`
   */
  async loginWithServiceAccount(role: string, tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token', opts?: LoginOptions): Promise<AuthInfo> {
    const { readFile } = await import('node:fs/promises');
    const jwt = (await readFile(tokenPath, 'utf8')).trim();
    return this.login(role, jwt, opts);
  }

  readConfig(opts?: CallOptions): Promise<Record<string, unknown>> {
    return getData(this.client, this.path('config'), opts);
  }

  async writeConfig(
    config: { kubernetes_host: string; kubernetes_ca_cert?: string; token_reviewer_jwt?: string; pem_keys?: string[]; disable_local_ca_jwt?: boolean; [key: string]: unknown },
    opts?: CallOptions,
  ): Promise<void> {
    await this.client.write(this.path('config'), compact(config), opts);
  }
}

// ================================================================== TLS certificates

/** TLS certificate auth method. The client certificate must be supplied via `requestInit.dispatcher` (undici Agent). */
export class CertAuth extends AuthMethodApi {
  readonly certs: Resource<Record<string, unknown>, { certificate?: string; allowed_common_names?: string[]; display_name?: string } & TokenFields & Record<string, unknown>>;

  constructor(client: OpenBaoCore, mount = 'cert') {
    super(client, mount);
    this.certs = new Resource(client, this.path('certs'));
  }

  login(name?: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login'), compact({ name }), opts);
  }
}

// ================================================================== RADIUS

export class RadiusAuth extends AuthMethodApi {
  readonly users: Resource<{ policies?: string[] }, { policies?: string[] }>;

  constructor(client: OpenBaoCore, mount = 'radius') {
    super(client, mount);
    this.users = new Resource(client, this.path('users'));
  }

  login(username: string, password: string, opts?: LoginOptions): Promise<AuthInfo> {
    return this.doLogin(this.path('login', username), { password }, opts);
  }

  async writeConfig(config: { host: string; secret: string; port?: number; [key: string]: unknown }, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('config'), compact(config), opts);
  }
}

// ================================================================== Kerberos

export class KerberosAuth extends AuthMethodApi {
  constructor(client: OpenBaoCore, mount = 'kerberos') {
    super(client, mount);
  }

  /** Logs in with a base64 SPNEGO token (sent as `Authorization: Negotiate <token>`). */
  login(spnegoToken: string, opts: LoginOptions = {}): Promise<AuthInfo> {
    return this.doLogin(this.path('login'), {}, { ...opts, headers: { ...opts.headers, Authorization: `Negotiate ${spnegoToken}` } });
  }
}

// ================================================================== Generic

/** Any auth method not covered above: `bao.auth.method('github').login({ token })`. */
export class GenericAuth extends AuthMethodApi {
  login(body: Record<string, unknown>, options: LoginOptions & { path?: string } = {}): Promise<AuthInfo> {
    const { path = 'login', ...opts } = options;
    return this.doLogin(this.path(path), body, opts);
  }
}

// ================================================================== Aggregator

/** Entry point for all auth methods. Factories accept a custom mount path. */
export class Auth {
  readonly token: TokenAuth;

  constructor(private readonly client: OpenBaoCore) {
    this.token = new TokenAuth(client);
  }

  approle(mount = 'approle') {
    return new AppRoleAuth(this.client, mount);
  }
  userpass(mount = 'userpass') {
    return new UserpassAuth(this.client, mount);
  }
  ldap(mount = 'ldap') {
    return new LdapAuth(this.client, mount);
  }
  jwt(mount = 'jwt') {
    return new JwtAuth(this.client, mount);
  }
  oidc(mount = 'oidc') {
    return new JwtAuth(this.client, mount);
  }
  kubernetes(mount = 'kubernetes') {
    return new KubernetesAuth(this.client, mount);
  }
  cert(mount = 'cert') {
    return new CertAuth(this.client, mount);
  }
  radius(mount = 'radius') {
    return new RadiusAuth(this.client, mount);
  }
  kerberos(mount = 'kerberos') {
    return new KerberosAuth(this.client, mount);
  }
  /** Generic accessor for any mounted auth method. */
  method(mount: string) {
    return new GenericAuth(this.client, mount);
  }
}
