import type { OpenBaoCore } from '../../core.js';
import type { ApiResponse, CallOptions, Duration } from '../../types.js';
import { compact } from '../../utils.js';
import { MountedApi, Resource, getData, postData } from '../base.js';

// ================================================================== TOTP

export interface TotpKeyOptions {
  /** Generate a key server-side (`true`) or import one via `url`/`key` (`false`). */
  generate?: boolean;
  exported?: boolean;
  key_size?: number;
  url?: string;
  key?: string;
  issuer?: string;
  account_name?: string;
  period?: Duration;
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  digits?: 6 | 8;
  skew?: 0 | 1;
  qr_size?: number;
}

export interface TotpKey {
  account_name: string;
  algorithm: string;
  digits: number;
  issuer: string;
  period: number;
}

/** TOTP secrets engine — generate and validate time-based one-time passwords. */
export class Totp extends MountedApi {
  constructor(client: OpenBaoCore, mount = 'totp') {
    super(client, mount);
  }

  /** Creates a key. When `generate` and `exported` are set, returns the provisioning `url` and base64 PNG `barcode`. */
  async createKey(name: string, options: TotpKeyOptions, opts?: CallOptions): Promise<{ url?: string; barcode?: string }> {
    const res = await this.client.write<{ url?: string; barcode?: string }>(this.path('keys', name), compact(options), opts);
    return res?.data ?? {};
  }

  readKey(name: string, opts?: CallOptions): Promise<TotpKey> {
    return getData(this.client, this.path('keys', name), opts);
  }

  async listKeys(opts?: CallOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('keys')}/`, opts)).keys;
  }

  async deleteKey(name: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path('keys', name), opts);
  }

  /** Generates the current code (only for keys created with `generate: true`). */
  async code(name: string, opts?: CallOptions): Promise<string> {
    return (await getData<{ code: string }>(this.client, this.path('code', name), opts)).code;
  }

  async validate(name: string, code: string, opts?: CallOptions): Promise<boolean> {
    return (await postData<{ valid: boolean }>(this.client, this.path('code', name), { code }, opts)).valid;
  }
}

// ================================================================== SSH

export interface SshRole {
  key_type: 'otp' | 'ca';
  default_user?: string;
  allowed_users?: string;
  allowed_domains?: string;
  ttl?: Duration;
  max_ttl?: Duration;
  allow_user_certificates?: boolean;
  allow_host_certificates?: boolean;
  allowed_extensions?: string;
  default_extensions?: Record<string, string>;
  allowed_critical_options?: string;
  cidr_list?: string;
  [key: string]: unknown;
}

export interface SshSignOptions {
  valid_principals?: string | string[];
  ttl?: Duration;
  cert_type?: 'user' | 'host';
  key_id?: string;
  critical_options?: Record<string, string>;
  extensions?: Record<string, string>;
  [key: string]: unknown;
}

/** SSH secrets engine — signed certificates and one-time passwords. */
export class Ssh extends MountedApi {
  readonly roles: Resource<SshRole, SshRole>;

  constructor(client: OpenBaoCore, mount = 'ssh') {
    super(client, mount);
    this.roles = new Resource(client, this.path('roles'));
  }

  /** Configures the signing CA. With no keys given, one is generated. Returns the CA public key. */
  async configureCa(
    options: { private_key?: string; public_key?: string; generate_signing_key?: boolean; key_type?: string; key_bits?: number } = { generate_signing_key: true },
    opts?: CallOptions,
  ): Promise<string | undefined> {
    const res = await this.client.write<{ public_key: string }>(this.path('config', 'ca'), compact(options), opts);
    return res?.data?.public_key;
  }

  async readCaPublicKey(opts?: CallOptions): Promise<string> {
    return (await getData<{ public_key: string }>(this.client, this.path('config', 'ca'), opts)).public_key;
  }

  async deleteCa(opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path('config', 'ca'), opts);
  }

  /** Signs an SSH public key. */
  sign(role: string, publicKey: string, options: SshSignOptions = {}, opts?: CallOptions): Promise<{ serial_number: string; signed_key: string }> {
    const valid_principals = Array.isArray(options.valid_principals) ? options.valid_principals.join(',') : options.valid_principals;
    return postData(this.client, this.path('sign', role), compact({ ...options, valid_principals, public_key: publicKey }), opts);
  }

  /** Generates a key pair and signs it. */
  issue(role: string, options: SshSignOptions & { key_type?: string; key_bits?: number } = {}, opts?: CallOptions): Promise<{ serial_number: string; signed_key: string; private_key: string; private_key_type: string }> {
    const valid_principals = Array.isArray(options.valid_principals) ? options.valid_principals.join(',') : options.valid_principals;
    return postData(this.client, this.path('issue', role), compact({ ...options, valid_principals }), opts);
  }

  /** Creates an OTP credential for an OTP role. */
  otp(role: string, ip: string, username?: string, opts?: CallOptions): Promise<{ key: string; key_type: string; username: string; ip: string; port: number }> {
    return postData(this.client, this.path('creds', role), compact({ ip, username }), opts);
  }

  verifyOtp(otp: string, opts?: CallOptions): Promise<{ ip: string; username: string; role_name: string }> {
    return postData(this.client, this.path('verify'), { otp }, opts);
  }
}

// ================================================================== Identity

export interface Entity {
  id: string;
  name: string;
  metadata: Record<string, string> | null;
  policies: string[] | null;
  disabled: boolean;
  aliases: EntityAlias[];
  group_ids?: string[];
  direct_group_ids?: string[];
  inherited_group_ids?: string[];
  creation_time?: string;
  last_update_time?: string;
  [key: string]: unknown;
}

export interface EntityAlias {
  id: string;
  name: string;
  canonical_id: string;
  mount_accessor: string;
  mount_path?: string;
  mount_type?: string;
  custom_metadata?: Record<string, string> | null;
  [key: string]: unknown;
}

export interface EntityInput {
  name?: string;
  metadata?: Record<string, string>;
  policies?: string[];
  disabled?: boolean;
}

export interface Group {
  id: string;
  name: string;
  type: 'internal' | 'external';
  metadata: Record<string, string> | null;
  policies: string[] | null;
  member_entity_ids: string[] | null;
  member_group_ids: string[] | null;
  alias?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GroupInput {
  name?: string;
  type?: 'internal' | 'external';
  metadata?: Record<string, string>;
  policies?: string[];
  member_entity_ids?: string[];
  member_group_ids?: string[];
}

/** CRUD for entity-like identity objects that are addressable by `id/` and `name/`. */
export class IdentityCollection<T, Input extends object> {
  /** Access by name (`identity/<kind>/name/:name`). */
  readonly byName: Resource<T, Input>;
  /** Access by id (`identity/<kind>/id/:id`). */
  readonly byId: Resource<T, Input>;

  constructor(
    private readonly client: OpenBaoCore,
    private readonly kind: string,
  ) {
    this.byName = new Resource<T, Input>(client, `identity/${kind}/name`);
    this.byId = new Resource<T, Input>(client, `identity/${kind}/id`);
  }

  /** Creates (or updates, when `id` is given) and returns `{ id, name }`. */
  async create(input: Input & { id?: string }, opts?: CallOptions): Promise<{ id: string; name: string } | undefined> {
    const res = await this.client.write<{ id: string; name: string }>(`identity/${this.kind}`, compact(input), opts);
    return res?.data;
  }
}

/** Identity secrets engine — entities, aliases, groups and identity tokens. */
export class Identity {
  readonly entities: IdentityCollection<Entity, EntityInput>;
  readonly groups: IdentityCollection<Group, GroupInput>;
  /** Entity aliases (`identity/entity-alias/id/:id`). */
  readonly entityAliases: Resource<EntityAlias, { name?: string; canonical_id?: string; mount_accessor?: string; custom_metadata?: Record<string, string> }>;
  /** Group aliases (`identity/group-alias/id/:id`). */
  readonly groupAliases: Resource<Record<string, unknown>, { name?: string; canonical_id?: string; mount_accessor?: string }>;

  constructor(private readonly client: OpenBaoCore) {
    this.entities = new IdentityCollection(client, 'entity');
    this.groups = new IdentityCollection(client, 'group');
    this.entityAliases = new Resource(client, 'identity/entity-alias/id');
    this.groupAliases = new Resource(client, 'identity/group-alias/id');
  }

  /** Creates an entity alias linking an auth-method identity to an entity. */
  async createEntityAlias(input: { name: string; canonical_id: string; mount_accessor: string; custom_metadata?: Record<string, string> }, opts?: CallOptions): Promise<{ id: string; canonical_id: string } | undefined> {
    return (await this.client.write<{ id: string; canonical_id: string }>('identity/entity-alias', compact(input), opts))?.data;
  }

  async createGroupAlias(input: { name: string; canonical_id?: string; mount_accessor: string }, opts?: CallOptions): Promise<{ id: string; canonical_id: string } | undefined> {
    return (await this.client.write<{ id: string; canonical_id: string }>('identity/group-alias', compact(input), opts))?.data;
  }

  /** Merges entities into `toEntityId`. */
  async mergeEntities(fromEntityIds: string[], toEntityId: string, options: { force?: boolean } = {}, opts?: CallOptions): Promise<void> {
    await this.client.write('identity/entity/merge', compact({ from_entity_ids: fromEntityIds, to_entity_id: toEntityId, force: options.force }), opts);
  }

  /** Looks up an entity by `name`, `id`, `alias_id`, or `alias_name` + `alias_mount_accessor`. Returns `undefined` when not found. */
  async lookupEntity(criteria: { name?: string; id?: string; alias_id?: string; alias_name?: string; alias_mount_accessor?: string }, opts?: CallOptions): Promise<Entity | undefined> {
    return (await this.client.write<Entity>('identity/lookup/entity', compact(criteria), opts))?.data;
  }

  async lookupGroup(criteria: { name?: string; id?: string; alias_id?: string; alias_name?: string; alias_mount_accessor?: string }, opts?: CallOptions): Promise<Group | undefined> {
    return (await this.client.write<Group>('identity/lookup/group', compact(criteria), opts))?.data;
  }

  /** Generates a signed OIDC identity token for the calling entity. */
  oidcToken(role: string, opts?: CallOptions): Promise<{ token: string; client_id: string; ttl: number }> {
    return getData(this.client, `identity/oidc/token/${encodeURIComponent(role)}`, opts);
  }

  async introspectOidcToken(token: string, clientId?: string, opts?: CallOptions): Promise<{ active: boolean; [key: string]: unknown }> {
    const res = await this.client.request<ApiResponse<unknown> & { active: boolean }>({
      ...opts,
      method: 'POST',
      path: 'identity/oidc/introspect',
      body: compact({ token, client_id: clientId }),
    });
    return res as unknown as { active: boolean };
  }
}
