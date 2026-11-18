import type { OpenBaoCore } from '../../core.js';
import type { CallOptions, Duration, ListData, ListOptions } from '../../types.js';
import { compact } from '../../utils.js';
import { OpenBaoError } from '../../errors.js';
import { MountedApi, unwrapData } from '../base.js';

export type SecretData = Record<string, unknown>;

// ================================================================== KV v1

/** KV version 1 secrets engine (also usable for any unversioned key/value mount). */
export class KvV1 extends MountedApi {
  constructor(client: OpenBaoCore, mount = 'kv') {
    super(client, mount);
  }

  /** Reads a secret. Throws `OpenBaoError` (404) if it does not exist. */
  async get<T extends SecretData = SecretData>(path: string, opts?: CallOptions): Promise<T> {
    return (await this.client.read<T>(this.path(path), opts)).data;
  }

  /** Creates or replaces a secret. */
  async set(path: string, data: SecretData, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path(path), data, opts);
  }

  async delete(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path(path), opts);
  }

  /** Lists keys under a folder. Folders end with `/`. */
  async list(path = '', opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path(path)}/`, opts)).keys;
  }
}

// ================================================================== KV v2

export interface KvV2VersionMetadata {
  created_time: string;
  deletion_time: string;
  destroyed: boolean;
  version: number;
  custom_metadata: Record<string, string> | null;
}

export interface KvV2Secret<T extends SecretData = SecretData> {
  data: T;
  metadata: KvV2VersionMetadata;
}

export interface KvV2Metadata {
  cas_required: boolean;
  created_time: string;
  current_version: number;
  delete_version_after: string;
  max_versions: number;
  oldest_version: number;
  updated_time: string;
  custom_metadata: Record<string, string> | null;
  versions: Record<string, { created_time: string; deletion_time: string; destroyed: boolean }>;
}

export interface KvV2MetadataInput {
  max_versions?: number;
  cas_required?: boolean;
  delete_version_after?: Duration;
  custom_metadata?: Record<string, string>;
}

export interface KvV2Config {
  max_versions?: number;
  cas_required?: boolean;
  delete_version_after?: Duration;
}

/** KV version 2 (versioned) secrets engine. Paths are logical — `data/` & `metadata/` are added for you. */
export class KvV2 extends MountedApi {
  constructor(client: OpenBaoCore, mount = 'secret') {
    super(client, mount);
  }

  /** Reads the latest (or a specific) version of a secret with its metadata. */
  async read<T extends SecretData = SecretData>(path: string, options: { version?: number } & CallOptions = {}): Promise<KvV2Secret<T>> {
    const { version, ...opts } = options;
    const res = await this.client.read<KvV2Secret<T>>(this.path('data', path), { ...opts, query: { version } });
    return res.data;
  }

  /** Reads just the secret payload. Throws `OpenBaoError` (404) when missing or deleted. */
  async get<T extends SecretData = SecretData>(path: string, options: { version?: number } & CallOptions = {}): Promise<T> {
    const secret = await this.read<T>(path, options);
    if (secret.data == null) {
      // Deleted/destroyed versions normally 404 already; normalize defensively.
      throw new OpenBaoError({ status: 404, method: 'GET', path: this.path('data', path), errors: ['secret version is deleted or destroyed'] });
    }
    return secret.data;
  }

  /**
   * Writes a new version. Pass `cas` for check-and-set (`0` = only create if absent).
   * Returns metadata for the new version.
   */
  async write(path: string, data: SecretData, options: { cas?: number } & CallOptions = {}): Promise<KvV2VersionMetadata> {
    const { cas, ...opts } = options;
    const body = cas === undefined ? { data } : { options: { cas }, data };
    return unwrapData(await this.client.write<KvV2VersionMetadata>(this.path('data', path), body, opts));
  }

  /** Alias of {@link write}. */
  set(path: string, data: SecretData, options: { cas?: number } & CallOptions = {}): Promise<KvV2VersionMetadata> {
    return this.write(path, data, options);
  }

  /**
   * JSON merge-patches the latest version (keys set to `null` are removed).
   * Requires the `patch` capability.
   */
  async patch(path: string, data: Record<string, unknown>, options: { cas?: number } & CallOptions = {}): Promise<KvV2VersionMetadata> {
    const { cas, ...opts } = options;
    const body = cas === undefined ? { data } : { options: { cas }, data };
    return unwrapData(await this.client.patch<KvV2VersionMetadata>(this.path('data', path), body, opts));
  }

  /** Returns the key structure of a secret (values replaced by `null`). */
  async subkeys(path: string, options: { version?: number; depth?: number } & CallOptions = {}): Promise<{ subkeys: Record<string, unknown>; metadata: KvV2VersionMetadata }> {
    const { version, depth, ...opts } = options;
    return (await this.client.read<{ subkeys: Record<string, unknown>; metadata: KvV2VersionMetadata }>(this.path('subkeys', path), { ...opts, query: { version, depth } })).data;
  }

  /** Soft-deletes the latest version (recoverable with {@link undelete}). */
  async delete(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path('data', path), opts);
  }

  /** Soft-deletes specific versions. */
  async deleteVersions(path: string, versions: number[], opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('delete', path), { versions }, opts);
  }

  async undelete(path: string, versions: number[], opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('undelete', path), { versions }, opts);
  }

  /** Permanently destroys versions' data. */
  async destroy(path: string, versions: number[], opts?: CallOptions): Promise<void> {
    await this.client.request({ ...opts, method: 'PUT', path: this.path('destroy', path), body: { versions } });
  }

  /** Lists keys under a folder (folders end with `/`). Returns `[]` for empty/missing folders. */
  async list(path = '', opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('metadata', path)}/`, opts)).keys;
  }

  /** Recursively lists every key under a folder (OpenBao `SCAN`). */
  async scan(path = '', opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.scan(`${this.path('metadata', path)}/`, opts)).keys;
  }

  /** Lists keys together with their full metadata (OpenBao `detailed-metadata`). */
  async listDetailed(path = '', opts?: CallOptions & ListOptions): Promise<ListData<KvV2Metadata>> {
    return this.client.list<KvV2Metadata>(`${this.path('detailed-metadata', path)}/`, opts);
  }

  async readMetadata(path: string, opts?: CallOptions): Promise<KvV2Metadata> {
    return (await this.client.read<KvV2Metadata>(this.path('metadata', path), opts)).data;
  }

  async writeMetadata(path: string, metadata: KvV2MetadataInput, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('metadata', path), compact(metadata), opts);
  }

  async patchMetadata(path: string, metadata: KvV2MetadataInput, opts?: CallOptions): Promise<void> {
    await this.client.patch(this.path('metadata', path), compact(metadata), opts);
  }

  /** Permanently deletes the key, all versions and metadata. */
  async deleteMetadata(path: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path('metadata', path), opts);
  }

  async readConfig(opts?: CallOptions): Promise<Required<KvV2Config>> {
    return (await this.client.read<Required<KvV2Config>>(this.path('config'), opts)).data;
  }

  async writeConfig(config: KvV2Config, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('config'), compact(config), opts);
  }
}

// ================================================================== Cubbyhole

/** Per-token private storage at `cubbyhole/`. */
export class Cubbyhole extends KvV1 {
  constructor(client: OpenBaoCore) {
    super(client, 'cubbyhole');
  }
}
