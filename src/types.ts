/** HTTP methods understood by OpenBao. `LIST` and `SCAN` are OpenBao-specific verbs. */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'LIST' | 'SCAN';

/** A duration accepted by OpenBao: seconds as a number, or a Go duration string such as `"1h30m"`. */
export type Duration = string | number;

/** Query-string values. Arrays are serialized as repeated keys; `undefined` values are dropped. */
export type QueryValue = string | number | boolean | undefined | null | ReadonlyArray<string | number>;
export type Query = Record<string, QueryValue>;

/** Response-wrapping information returned when a request was made with a wrap TTL. */
export interface WrapInfo {
  token: string;
  accessor: string;
  ttl: number;
  creation_time: string;
  creation_path: string;
  wrapped_accessor?: string;
}

/** The `auth` block returned by login endpoints and token creation. */
export interface AuthInfo {
  client_token: string;
  accessor: string;
  policies: string[];
  token_policies: string[];
  identity_policies?: string[];
  metadata: Record<string, string> | null;
  lease_duration: number;
  renewable: boolean;
  entity_id: string;
  token_type: 'service' | 'batch' | (string & {});
  orphan: boolean;
  num_uses?: number;
  mfa_requirement?: unknown;
}

/** The standard OpenBao response envelope. */
export interface ApiResponse<T = Record<string, unknown>> {
  request_id: string;
  lease_id: string;
  renewable: boolean;
  lease_duration: number;
  data: T;
  wrap_info: WrapInfo | null;
  warnings: string[] | null;
  auth: AuthInfo | null;
  mount_type?: string;
}

/** Shape of `data` returned by LIST / SCAN operations. */
export interface ListData<Info = unknown> {
  keys: string[];
  key_info?: Record<string, Info>;
}

/** Pagination options supported by OpenBao LIST endpoints. */
export interface ListOptions {
  /** Return keys lexicographically after this one. */
  after?: string;
  /** Maximum number of keys to return (0 = all). */
  limit?: number;
}

/** Options shared by every request helper. */
export interface CallOptions {
  /** Override the client namespace for this call (`null` sends no namespace header). */
  namespace?: string | null;
  /** Override the client token for this call (`null` sends no token). */
  token?: string | null;
  /** Ask OpenBao to wrap the response in a cubbyhole token with this TTL. */
  wrapTTL?: Duration;
  /** Abort signal for this call. */
  signal?: AbortSignal;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

/** Options accepted by login helpers. */
export interface LoginOptions extends Pick<CallOptions, 'namespace' | 'signal' | 'headers'> {
  /**
   * Store the returned client token on the client so subsequent calls are authenticated.
   * @default true
   */
  setToken?: boolean;
}

/** Common token-related tunables used by most auth-method role definitions. */
export interface TokenFields {
  token_ttl?: Duration;
  token_max_ttl?: Duration;
  token_policies?: string[];
  token_bound_cidrs?: string[];
  token_explicit_max_ttl?: Duration;
  token_no_default_policy?: boolean;
  token_num_uses?: number;
  token_period?: Duration;
  token_type?: 'service' | 'batch' | 'default' | 'default-service' | 'default-batch';
}
