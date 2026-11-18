import type { OpenBaoCore } from '../core.js';
import type { ApiResponse, CallOptions, Duration, ListOptions } from '../types.js';
import { compact, joinFolder, joinPath, toBase64 } from '../utils.js';
import { unwrapData } from './base.js';

// ------------------------------------------------------------------ types

export interface HealthStatus {
  initialized: boolean;
  sealed: boolean;
  standby: boolean;
  performance_standby?: boolean;
  replication_performance_mode?: string;
  replication_dr_mode?: string;
  server_time_utc: number;
  version: string;
  cluster_name?: string;
  cluster_id?: string;
  enterprise?: boolean;
  echo_duration_ms?: number;
  clock_skew_ms?: number;
}

export interface HealthOptions extends Pick<CallOptions, 'signal'> {
  standbyok?: boolean;
  perfstandbyok?: boolean;
  activecode?: number;
  standbycode?: number;
  sealedcode?: number;
  uninitcode?: number;
  perfstandbycode?: number;
}

export interface SealStatus {
  type: string;
  initialized: boolean;
  sealed: boolean;
  t: number;
  n: number;
  progress: number;
  nonce: string;
  version?: string;
  build_date?: string;
  migration?: boolean;
  cluster_name?: string;
  cluster_id?: string;
  recovery_seal?: boolean;
  storage_type?: string;
}

export interface InitOptions {
  secret_shares?: number;
  secret_threshold?: number;
  pgp_keys?: string[];
  root_token_pgp_key?: string;
  recovery_shares?: number;
  recovery_threshold?: number;
  recovery_pgp_keys?: string[];
  stored_shares?: number;
}

export interface InitResult {
  keys: string[];
  keys_base64: string[];
  recovery_keys?: string[];
  recovery_keys_base64?: string[];
  root_token: string;
}

export interface LeaderStatus {
  ha_enabled: boolean;
  is_self: boolean;
  active_time?: string;
  leader_address: string;
  leader_cluster_address: string;
  performance_standby?: boolean;
  performance_standby_last_remote_wal?: number;
  raft_committed_index?: number;
  raft_applied_index?: number;
}

export interface MountConfig {
  default_lease_ttl?: Duration;
  max_lease_ttl?: Duration;
  force_no_cache?: boolean;
  audit_non_hmac_request_keys?: string[];
  audit_non_hmac_response_keys?: string[];
  listing_visibility?: 'unauth' | 'hidden' | '';
  passthrough_request_headers?: string[];
  allowed_response_headers?: string[];
  plugin_version?: string;
  [key: string]: unknown;
}

export interface MountInfo {
  type: string;
  description: string;
  accessor: string;
  uuid?: string;
  config: MountConfig;
  options: Record<string, string> | null;
  local: boolean;
  seal_wrap: boolean;
  external_entropy_access?: boolean;
  plugin_version?: string;
  running_plugin_version?: string;
  running_sha256?: string;
}

export interface EnableMountOptions {
  /** Engine type, e.g. `kv`, `transit`, `pki`, `database`. */
  type: string;
  description?: string;
  config?: MountConfig;
  /** Engine options, e.g. `{ version: '2' }` for KV v2. */
  options?: Record<string, string>;
  local?: boolean;
  seal_wrap?: boolean;
  external_entropy_access?: boolean;
  plugin_version?: string;
}

export interface EnableAuthOptions {
  /** Auth method type, e.g. `approle`, `userpass`, `jwt`, `kubernetes`. */
  type: string;
  description?: string;
  config?: MountConfig & { token_type?: string };
  options?: Record<string, string>;
  local?: boolean;
  seal_wrap?: boolean;
  plugin_version?: string;
}

export interface LeaseInfo {
  id: string;
  issue_time: string;
  expire_time: string | null;
  last_renewal: string | null;
  renewable: boolean;
  ttl: number;
}

export interface AuditDevice {
  type: string;
  description: string;
  options: Record<string, string>;
  local: boolean;
  path: string;
}

export interface NamespaceInfo {
  id: string;
  path: string;
  custom_metadata: Record<string, string>;
  [key: string]: unknown;
}

// ------------------------------------------------------------------ sub-APIs

/** `sys/mounts` — secrets engine management. */
export class SysMounts {
  constructor(private readonly client: OpenBaoCore) {}

  /** Lists all mounted secrets engines keyed by path (`secret/`, `transit/`, ...). */
  async list(opts?: CallOptions): Promise<Record<string, MountInfo>> {
    const res = await this.client.read<Record<string, MountInfo>>('sys/mounts', opts);
    return unwrapData(res);
  }

  /** Reads one mount's configuration. */
  async read(path: string, opts?: CallOptions): Promise<MountInfo> {
    return unwrapData(await this.client.read<MountInfo>(joinPath('sys/mounts', path), opts));
  }

  /** Mounts a secrets engine at `path`. */
  async enable(path: string, options: EnableMountOptions, opts?: CallOptions): Promise<void> {
    await this.client.write(joinPath('sys/mounts', path), compact(options), opts);
  }

  /** Unmounts a secrets engine (destroys all its data). */
  async disable(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath('sys/mounts', path), opts);
  }

  async readTune(path: string, opts?: CallOptions): Promise<MountConfig> {
    return unwrapData(await this.client.read<MountConfig>(joinPath('sys/mounts', path, 'tune'), opts));
  }

  async tune(path: string, config: MountConfig & { description?: string; options?: Record<string, string> }, opts?: CallOptions): Promise<void> {
    await this.client.write(joinPath('sys/mounts', path, 'tune'), compact(config), opts);
  }

  /** Moves a mount (`sys/remount`). Returns the migration id. */
  async remount(from: string, to: string, opts?: CallOptions): Promise<{ migration_id: string } | undefined> {
    const res = await this.client.write<{ migration_id: string }>('sys/remount', { from, to }, opts);
    return res ? unwrapData(res) : undefined;
  }
}

/** `sys/auth` — auth method management. */
export class SysAuth {
  constructor(private readonly client: OpenBaoCore) {}

  async list(opts?: CallOptions): Promise<Record<string, MountInfo>> {
    return unwrapData(await this.client.read<Record<string, MountInfo>>('sys/auth', opts));
  }

  async read(path: string, opts?: CallOptions): Promise<MountInfo> {
    return unwrapData(await this.client.read<MountInfo>(joinPath('sys/auth', path), opts));
  }

  async enable(path: string, options: EnableAuthOptions, opts?: CallOptions): Promise<void> {
    await this.client.write(joinPath('sys/auth', path), compact(options), opts);
  }

  async disable(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath('sys/auth', path), opts);
  }

  async readTune(path: string, opts?: CallOptions): Promise<MountConfig> {
    return unwrapData(await this.client.read<MountConfig>(joinPath('sys/auth', path, 'tune'), opts));
  }

  async tune(path: string, config: MountConfig & { description?: string; token_type?: string }, opts?: CallOptions): Promise<void> {
    await this.client.write(joinPath('sys/auth', path, 'tune'), compact(config), opts);
  }
}

/** `sys/policies/acl` — ACL policies. */
export class SysAclPolicies {
  constructor(private readonly client: OpenBaoCore) {}

  async list(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(joinFolder('sys/policies/acl'), opts)).keys;
  }

  /** Returns the policy HCL text. */
  async read(name: string, opts?: CallOptions): Promise<string> {
    const res = unwrapData<{ policy: string }>(await this.client.read(joinPath('sys/policies/acl', name), opts));
    return res.policy;
  }

  /** Creates or replaces a policy from HCL/JSON text. */
  async write(name: string, policy: string, opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: joinPath('sys/policies/acl', name), body: { policy } });
  }

  async delete(name: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath('sys/policies/acl', name), opts);
  }
}

/** `sys/policies/password` — password generation policies. */
export class SysPasswordPolicies {
  constructor(private readonly client: OpenBaoCore) {}

  async list(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(joinFolder('sys/policies/password'), opts)).keys;
  }

  async read(name: string, opts?: CallOptions): Promise<string> {
    return unwrapData<{ policy: string }>(await this.client.read(joinPath('sys/policies/password', name), opts)).policy;
  }

  async write(name: string, policy: string, opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: joinPath('sys/policies/password', name), body: { policy } });
  }

  async delete(name: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath('sys/policies/password', name), opts);
  }

  /** Generates a password from the named policy. */
  async generate(name: string, opts?: CallOptions): Promise<string> {
    return unwrapData<{ password: string }>(await this.client.read(joinPath('sys/policies/password', name, 'generate'), opts)).password;
  }
}

/** `sys/leases` — lease lookup, renewal and revocation. */
export class SysLeases {
  constructor(private readonly client: OpenBaoCore) {}

  async lookup(leaseId: string, opts?: CallOptions): Promise<LeaseInfo> {
    const res = await this.client.request<ApiResponse<LeaseInfo>>({ ...opts, method: 'PUT', path: 'sys/leases/lookup', body: { lease_id: leaseId } });
    return unwrapData(res);
  }

  /** Lists lease ids under a prefix, e.g. `database/creds/readonly/`. */
  async list(prefix: string, opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(joinFolder('sys/leases/lookup', prefix), opts)).keys;
  }

  /** Renews a lease. Returns the new response envelope (with updated `lease_duration`). */
  renew(leaseId: string, increment?: Duration, opts?: CallOptions): Promise<ApiResponse<unknown>> {
    return this.client.request<ApiResponse<unknown>>({
      ...opts,
      method: 'PUT',
      path: 'sys/leases/renew',
      body: compact({ lease_id: leaseId, increment }),
    });
  }

  async revoke(leaseId: string, options: { sync?: boolean } & CallOptions = {}): Promise<void> {
    const { sync, ...opts } = options;
    await this.client.request({ ...opts, method: 'PUT', path: 'sys/leases/revoke', body: compact({ lease_id: leaseId, sync }) });
  }

  async revokePrefix(prefix: string, options: { sync?: boolean } & CallOptions = {}): Promise<void> {
    const { sync, ...opts } = options;
    await this.client.request({ ...opts, method: 'PUT', path: joinPath('sys/leases/revoke-prefix', prefix), body: compact({ sync }) });
  }

  /** Revokes all leases under prefix ignoring backend errors. Requires `sudo`. */
  async revokeForce(prefix: string, opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: joinPath('sys/leases/revoke-force', prefix) });
  }

  async tidy(opts?: CallOptions): Promise<void> {
    await this.client.write('sys/leases/tidy', {}, opts);
  }
}

/** `sys/wrapping/*` — response wrapping. */
export class SysWrapping {
  constructor(private readonly client: OpenBaoCore) {}

  /** Wraps arbitrary data in a single-use token. Returns the wrap info (use `.token`). */
  async wrap(data: Record<string, unknown>, ttl: Duration = '5m', opts?: Omit<CallOptions, 'wrapTTL'>) {
    const res = await this.client.request<ApiResponse<unknown>>({ ...opts, method: 'POST', path: 'sys/wrapping/wrap', body: data, wrapTTL: ttl });
    if (!res?.wrap_info) throw new Error('sys/wrapping/wrap returned no wrap_info');
    return res.wrap_info;
  }

  /**
   * Unwraps a wrapping token. Returns the original response envelope, so both
   * wrapped secrets (`.data`) and wrapped logins (`.auth`) are available.
   */
  unwrap<T = Record<string, unknown>>(wrappingToken?: string, opts?: CallOptions): Promise<ApiResponse<T>> {
    return this.client.request<ApiResponse<T>>({
      ...opts,
      method: 'POST',
      path: 'sys/wrapping/unwrap',
      body: wrappingToken ? { token: wrappingToken } : {},
    });
  }

  async lookup(wrappingToken: string, opts?: CallOptions): Promise<{ creation_ttl: number; creation_time: string; creation_path: string }> {
    return unwrapData(
      await this.client.request<ApiResponse<{ creation_ttl: number; creation_time: string; creation_path: string }>>({
        ...opts,
        method: 'POST',
        path: 'sys/wrapping/lookup',
        body: { token: wrappingToken },
        token: opts?.token ?? null,
      }),
    );
  }

  async rewrap(wrappingToken: string, opts?: CallOptions) {
    const res = await this.client.request<ApiResponse<unknown>>({ ...opts, method: 'POST', path: 'sys/wrapping/rewrap', body: { token: wrappingToken } });
    if (!res?.wrap_info) throw new Error('sys/wrapping/rewrap returned no wrap_info');
    return res.wrap_info;
  }
}

/** `sys/tools/*` — random bytes and hashing. */
export class SysTools {
  constructor(private readonly client: OpenBaoCore) {}

  async random(
    bytes = 32,
    options: { format?: 'base64' | 'hex'; source?: 'platform' | 'seal' | 'all' } & CallOptions = {},
  ): Promise<string> {
    const { format, source, ...opts } = options;
    const res = await this.client.write<{ random_bytes: string }>(joinPath('sys/tools/random', source, bytes), compact({ format }), opts);
    return unwrapData<{ random_bytes: string }>(res).random_bytes;
  }

  /** Hashes input (string or bytes; base64-encoded automatically). */
  async hash(
    input: string | Uint8Array,
    options: { algorithm?: 'sha2-224' | 'sha2-256' | 'sha2-384' | 'sha2-512' | 'sha3-224' | 'sha3-256' | 'sha3-384' | 'sha3-512'; format?: 'hex' | 'base64' } & CallOptions = {},
  ): Promise<string> {
    const { algorithm, format, ...opts } = options;
    const res = await this.client.write<{ sum: string }>(joinPath('sys/tools/hash', algorithm), compact({ input: toBase64(input), format }), opts);
    return unwrapData<{ sum: string }>(res).sum;
  }
}

/** `sys/audit` — audit devices. */
export class SysAudit {
  constructor(private readonly client: OpenBaoCore) {}

  async list(opts?: CallOptions): Promise<Record<string, AuditDevice>> {
    return unwrapData(await this.client.read<Record<string, AuditDevice>>('sys/audit', opts));
  }

  /**
   * Enables an audit device. Note: recent OpenBao releases may require audit
   * devices to be declared in server configuration instead of via the API.
   */
  async enable(
    path: string,
    options: { type: string; description?: string; options?: Record<string, string>; local?: boolean },
    opts?: CallOptions,
  ): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: joinPath('sys/audit', path), body: compact(options) });
  }

  async disable(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath('sys/audit', path), opts);
  }

  /** Hashes `input` with the audit device's HMAC key (`sys/audit-hash`). */
  async hash(path: string, input: string, opts?: CallOptions): Promise<string> {
    return unwrapData<{ hash: string }>(await this.client.write(joinPath('sys/audit-hash', path), { input }, opts)).hash;
  }
}

/** `sys/namespaces` — namespace management. */
export class SysNamespaces {
  constructor(private readonly client: OpenBaoCore) {}

  /** Lists child namespaces of the current namespace. */
  async list(opts?: CallOptions & ListOptions): Promise<{ keys: string[]; key_info: Record<string, NamespaceInfo> }> {
    const res = await this.client.list<NamespaceInfo>('sys/namespaces', opts);
    return { keys: res.keys, key_info: res.key_info ?? {} };
  }

  async read(path: string, opts?: CallOptions): Promise<NamespaceInfo> {
    return unwrapData(await this.client.read<NamespaceInfo>(joinPath('sys/namespaces', path), opts));
  }

  async create(path: string, options: { custom_metadata?: Record<string, string>; seal?: unknown } & CallOptions = {}): Promise<NamespaceInfo> {
    const { custom_metadata, seal, ...opts } = options;
    const res = await this.client.write<NamespaceInfo>(joinPath('sys/namespaces', path), compact({ custom_metadata, seal }), opts);
    return unwrapData(res);
  }

  /** Merge-patches a namespace's custom metadata. */
  async patch(path: string, custom_metadata: Record<string, string | null>, opts?: CallOptions): Promise<NamespaceInfo> {
    return unwrapData(await this.client.patch<NamespaceInfo>(joinPath('sys/namespaces', path), { custom_metadata }, opts));
  }

  async delete(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(joinPath('sys/namespaces', path), opts);
  }

  async sealStatus(path: string, opts?: CallOptions): Promise<SealStatus> {
    return unwrapData(await this.client.read<SealStatus>(joinPath('sys/namespaces', path, 'seal-status'), opts));
  }

  async seal(path: string, opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: joinPath('sys/namespaces', path, 'seal') });
  }

  async unseal(path: string, key: string, options: { reset?: boolean } & CallOptions = {}): Promise<SealStatus> {
    const { reset, ...opts } = options;
    return unwrapData(
      await this.client.request<SealStatus>({ ...opts, method: 'PUT', path: joinPath('sys/namespaces', path, 'unseal'), body: compact({ key, reset }) }),
    );
  }
}

/** System backend (`/v1/sys/*`). */
export class Sys {
  readonly mounts: SysMounts;
  readonly auth: SysAuth;
  readonly policies: { acl: SysAclPolicies; password: SysPasswordPolicies };
  readonly leases: SysLeases;
  readonly wrapping: SysWrapping;
  readonly tools: SysTools;
  readonly audit: SysAudit;
  readonly namespaces: SysNamespaces;

  constructor(private readonly client: OpenBaoCore) {
    this.mounts = new SysMounts(client);
    this.auth = new SysAuth(client);
    this.policies = { acl: new SysAclPolicies(client), password: new SysPasswordPolicies(client) };
    this.leases = new SysLeases(client);
    this.wrapping = new SysWrapping(client);
    this.tools = new SysTools(client);
    this.audit = new SysAudit(client);
    this.namespaces = new SysNamespaces(client);
  }

  /**
   * Node health. Never throws for sealed / standby / uninitialized states —
   * inspect the returned flags instead. Unauthenticated.
   */
  health(options: HealthOptions = {}): Promise<HealthStatus> {
    const { signal, ...query } = options;
    return this.client.request<HealthStatus>({
      method: 'GET',
      path: 'sys/health',
      query,
      signal,
      token: null,
      acceptStatus: [429, 472, 473, 501, 503],
    });
  }

  sealStatus(opts?: CallOptions): Promise<SealStatus> {
    return this.client.request<SealStatus>({ ...opts, method: 'GET', path: 'sys/seal-status' });
  }

  async seal(opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: 'sys/seal' });
  }

  /** Submits one unseal key share. */
  unseal(key: string, options: { reset?: boolean; migrate?: boolean } & CallOptions = {}): Promise<SealStatus> {
    const { reset, migrate, ...opts } = options;
    return this.client.request<SealStatus>({ ...opts, method: 'PUT', path: 'sys/unseal', body: compact({ key, reset, migrate }) });
  }

  /** Resets unseal progress. */
  unsealReset(opts?: CallOptions): Promise<SealStatus> {
    return this.client.request<SealStatus>({ ...opts, method: 'PUT', path: 'sys/unseal', body: { reset: true } });
  }

  async initStatus(opts?: CallOptions): Promise<boolean> {
    return (await this.client.request<{ initialized: boolean }>({ ...opts, method: 'GET', path: 'sys/init' })).initialized;
  }

  /** Initializes a new server. Returns unseal keys and the initial root token. */
  init(options: InitOptions = { secret_shares: 5, secret_threshold: 3 }, opts?: CallOptions): Promise<InitResult> {
    return this.client.request<InitResult>({ ...opts, method: 'PUT', path: 'sys/init', body: compact(options), token: null });
  }

  leader(opts?: CallOptions): Promise<LeaderStatus> {
    return this.client.request<LeaderStatus>({ ...opts, method: 'GET', path: 'sys/leader' });
  }

  haStatus(opts?: CallOptions): Promise<{ nodes: Array<Record<string, unknown>> }> {
    return this.client.request({ ...opts, method: 'GET', path: 'sys/ha-status' });
  }

  async stepDown(opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: 'sys/step-down' });
  }

  async keyStatus(opts?: CallOptions): Promise<{ term: number; install_time: string; encryptions?: number }> {
    return unwrapData(await this.client.read('sys/key-status', opts));
  }

  /** Rotates the backend encryption key. */
  async rotate(opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: 'sys/rotate' });
  }

  async hostInfo(opts?: CallOptions): Promise<Record<string, unknown>> {
    return unwrapData(await this.client.read('sys/host-info', opts));
  }

  /** Versions this cluster has run, keyed by version string. */
  async versionHistory(opts?: CallOptions): Promise<{ keys: string[]; key_info: Record<string, { build_date: string; previous_version: string | null; timestamp_installed: string }> }> {
    const res = await this.client.list<{ build_date: string; previous_version: string | null; timestamp_installed: string }>('sys/version-history', opts);
    return { keys: res.keys, key_info: res.key_info ?? {} };
  }

  /** Returns `{ [path]: capabilities[] }` for the given token (or the client token via `capabilitiesSelf`). */
  async capabilities(token: string, paths: string[], opts?: CallOptions): Promise<Record<string, string[]>> {
    const res = await this.client.write<Record<string, string[]>>('sys/capabilities', { token, paths }, opts);
    return pickCapabilities(unwrapData(res), paths);
  }

  async capabilitiesSelf(paths: string[], opts?: CallOptions): Promise<Record<string, string[]>> {
    const res = await this.client.write<Record<string, string[]>>('sys/capabilities-self', { paths }, opts);
    return pickCapabilities(unwrapData(res), paths);
  }

  async capabilitiesAccessor(accessor: string, paths: string[], opts?: CallOptions): Promise<Record<string, string[]>> {
    const res = await this.client.write<Record<string, string[]>>('sys/capabilities-accessor', { accessor, paths }, opts);
    return pickCapabilities(unwrapData(res), paths);
  }

  /** Prometheus-format metrics (text) or JSON metrics. */
  metrics(format: 'prometheus' | 'json' = 'prometheus', opts?: CallOptions): Promise<string | Record<string, unknown>> {
    return this.client.request({ ...opts, method: 'GET', path: 'sys/metrics', query: { format: format === 'prometheus' ? 'prometheus' : undefined }, responseType: format === 'prometheus' ? 'text' : 'json' });
  }
}

function pickCapabilities(data: Record<string, unknown>, paths: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of paths) {
    const v = data[p];
    out[p] = Array.isArray(v) ? (v as string[]) : paths.length === 1 && Array.isArray(data['capabilities']) ? (data['capabilities'] as string[]) : [];
  }
  return out;
}
