import type { OpenBaoCore } from '../../core.js';
import type { ApiResponse, CallOptions, Duration } from '../../types.js';
import { joinPath } from '../../utils.js';
import { MountedApi, Resource, getData } from '../base.js';

export interface DatabaseConnectionConfig {
  /** Plugin, e.g. `postgresql-database-plugin`, `mysql-database-plugin`. */
  plugin_name: string;
  connection_url?: string;
  username?: string;
  password?: string;
  verify_connection?: boolean;
  allowed_roles?: string[];
  root_rotation_statements?: string[];
  password_policy?: string;
  plugin_version?: string;
  [key: string]: unknown;
}

export interface DatabaseRole {
  db_name: string;
  default_ttl?: Duration;
  max_ttl?: Duration;
  creation_statements?: string[];
  revocation_statements?: string[];
  rollback_statements?: string[];
  renew_statements?: string[];
  credential_type?: 'password' | 'rsa_private_key' | 'client_certificate';
  credential_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DatabaseStaticRole {
  db_name: string;
  username: string;
  rotation_period?: Duration;
  rotation_statements?: string[];
  credential_type?: string;
  credential_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DatabaseCredentials {
  username: string;
  password?: string;
  rsa_private_key?: string;
  [key: string]: unknown;
}

export interface StaticCredentials extends DatabaseCredentials {
  last_vault_rotation: string;
  rotation_period: number;
  ttl: number;
}

/** Database secrets engine — dynamic and static database credentials. */
export class Database extends MountedApi {
  /** Connection configurations (`<mount>/config/:name`). */
  readonly connections: Resource<DatabaseConnectionConfig, DatabaseConnectionConfig>;
  /** Dynamic roles (`<mount>/roles/:name`). */
  readonly roles: Resource<DatabaseRole, DatabaseRole>;
  /** Static roles (`<mount>/static-roles/:name`). */
  readonly staticRoles: Resource<DatabaseStaticRole, DatabaseStaticRole>;

  constructor(client: OpenBaoCore, mount = 'database') {
    super(client, mount);
    this.connections = new Resource(client, this.path('config'));
    this.roles = new Resource(client, this.path('roles'));
    this.staticRoles = new Resource(client, this.path('static-roles'));
  }

  /**
   * Generates dynamic credentials. Returns the full envelope so you can manage
   * the lease (`lease_id`, `lease_duration`) via `sys.leases`.
   */
  creds<T extends DatabaseCredentials = DatabaseCredentials>(role: string, opts?: CallOptions): Promise<ApiResponse<T>> {
    return this.client.read<T>(this.path('creds', role), opts);
  }

  /** Reads the current password of a static role. */
  staticCreds(role: string, opts?: CallOptions): Promise<StaticCredentials> {
    return getData(this.client, this.path('static-creds', role), opts);
  }

  async rotateRoot(connection: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('rotate-root', connection), {}, opts);
  }

  async rotateStaticRole(role: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('rotate-role', role), {}, opts);
  }

  /** Closes and reloads a connection (`<mount>/reset/:name`). */
  async resetConnection(connection: string, opts?: CallOptions): Promise<void> {
    await this.client.write(joinPath(this.mount, 'reset', connection), {}, opts);
  }
}
