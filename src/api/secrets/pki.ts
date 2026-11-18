import type { OpenBaoCore } from '../../core.js';
import type { CallOptions, Duration, ListOptions } from '../../types.js';
import { compact } from '../../utils.js';
import { MountedApi, Resource, getData, postData } from '../base.js';

export interface CertificateRequest {
  common_name?: string;
  alt_names?: string | string[];
  ip_sans?: string | string[];
  uri_sans?: string | string[];
  other_sans?: string | string[];
  ttl?: Duration;
  not_after?: string;
  format?: 'pem' | 'der' | 'pem_bundle';
  private_key_format?: 'der' | 'pkcs8' | '';
  exclude_cn_from_sans?: boolean;
  issuer_ref?: string;
  [key: string]: unknown;
}

export interface IssuedCertificate {
  certificate: string;
  issuing_ca: string;
  ca_chain: string[];
  private_key?: string;
  private_key_type?: string;
  serial_number: string;
  expiration: number;
}

export interface GenerateRootOptions {
  common_name: string;
  alt_names?: string;
  ttl?: Duration;
  key_type?: 'rsa' | 'ec' | 'ed25519';
  key_bits?: number;
  issuer_name?: string;
  key_name?: string;
  max_path_length?: number;
  organization?: string;
  ou?: string;
  country?: string;
  [key: string]: unknown;
}

export interface PkiRole {
  ttl?: Duration;
  max_ttl?: Duration;
  allow_localhost?: boolean;
  allowed_domains?: string[];
  allow_bare_domains?: boolean;
  allow_subdomains?: boolean;
  allow_glob_domains?: boolean;
  allow_any_name?: boolean;
  enforce_hostnames?: boolean;
  allow_ip_sans?: boolean;
  allowed_uri_sans?: string[];
  server_flag?: boolean;
  client_flag?: boolean;
  key_type?: 'rsa' | 'ec' | 'ed25519' | 'any';
  key_bits?: number;
  issuer_ref?: string;
  no_store?: boolean;
  generate_lease?: boolean;
  [key: string]: unknown;
}

const toList = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(',') : v);

function normalizeSans<T extends CertificateRequest>(req: T): T {
  return compact({
    ...req,
    alt_names: toList(req.alt_names),
    ip_sans: toList(req.ip_sans),
    uri_sans: toList(req.uri_sans),
    other_sans: toList(req.other_sans),
  });
}

/** PKI secrets engine — X.509 certificate authority. */
export class Pki extends MountedApi {
  /** Role definitions (`<mount>/roles/:name`). */
  readonly roles: Resource<PkiRole, PkiRole>;

  constructor(client: OpenBaoCore, mount = 'pki') {
    super(client, mount);
    this.roles = new Resource<PkiRole, PkiRole>(client, this.path('roles'));
  }

  /** Issues a certificate (and private key) against a role. */
  issue(role: string, request: CertificateRequest, opts?: CallOptions): Promise<IssuedCertificate> {
    return postData(this.client, this.path('issue', role), normalizeSans(request), opts);
  }

  /** Signs a CSR against a role. */
  sign(role: string, csr: string, request: CertificateRequest = {}, opts?: CallOptions): Promise<IssuedCertificate> {
    return postData(this.client, this.path('sign', role), normalizeSans({ ...request, csr }), opts);
  }

  /** Signs a CSR verbatim (bypasses role restrictions; requires sudo-like policy). */
  signVerbatim(csr: string, request: CertificateRequest & { role?: string } = {}, opts?: CallOptions): Promise<IssuedCertificate> {
    const { role, ...rest } = request;
    return postData(this.client, this.path('sign-verbatim', role), normalizeSans({ ...rest, csr }), opts);
  }

  async revoke(serialNumber: string, opts?: CallOptions): Promise<{ revocation_time: number; revocation_time_rfc3339?: string }> {
    return postData(this.client, this.path('revoke'), { serial_number: serialNumber }, opts);
  }

  /** Reads a certificate by serial (`ca`, `crl`, `ca_chain` are also accepted). */
  async readCert(serial: string, opts?: CallOptions): Promise<{ certificate: string; revocation_time: number; [key: string]: unknown }> {
    return getData(this.client, this.path('cert', serial), opts);
  }

  async listCerts(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('certs')}/`, opts)).keys;
  }

  async listRevokedCerts(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('certs', 'revoked')}/`, opts)).keys;
  }

  /** Default issuer's CA certificate as PEM. Unauthenticated. */
  caPem(opts?: CallOptions): Promise<string> {
    return this.client.request<string>({ ...opts, method: 'GET', path: this.path('ca', 'pem'), responseType: 'text', token: null });
  }

  /** Default issuer's CA chain as PEM. Unauthenticated. */
  caChainPem(opts?: CallOptions): Promise<string> {
    return this.client.request<string>({ ...opts, method: 'GET', path: this.path('ca_chain'), responseType: 'text', token: null });
  }

  /** Current CRL as PEM. Unauthenticated. */
  crlPem(opts?: CallOptions): Promise<string> {
    return this.client.request<string>({ ...opts, method: 'GET', path: this.path('crl', 'pem'), responseType: 'text', token: null });
  }

  // ------------------------------------------------------------ CA lifecycle

  /** Generates a self-signed root. `type: 'exported'` returns the private key. */
  generateRoot(
    options: GenerateRootOptions & { type?: 'internal' | 'exported' | 'existing' | 'kms' },
    opts?: CallOptions,
  ): Promise<{ certificate: string; issuing_ca: string; serial_number: string; issuer_id?: string; key_id?: string; private_key?: string; expiration: number }> {
    const { type = 'internal', ...body } = options;
    return postData(this.client, this.path('root', 'generate', type), compact(body), opts);
  }

  /** Generates an intermediate CSR. */
  generateIntermediate(
    options: GenerateRootOptions & { type?: 'internal' | 'exported' | 'existing' | 'kms' },
    opts?: CallOptions,
  ): Promise<{ csr: string; key_id?: string; private_key?: string }> {
    const { type = 'internal', ...body } = options;
    return postData(this.client, this.path('intermediate', 'generate', type), compact(body), opts);
  }

  /** Signs an intermediate CSR with this mount's root. */
  signIntermediate(csr: string, options: Partial<GenerateRootOptions> & { use_csr_values?: boolean; format?: string } = {}, opts?: CallOptions): Promise<IssuedCertificate> {
    return postData(this.client, this.path('root', 'sign-intermediate'), compact({ ...options, csr }), opts);
  }

  /** Imports the signed intermediate certificate. */
  async setSignedIntermediate(certificate: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('intermediate', 'set-signed'), { certificate }, opts);
  }

  /** Imports a PEM bundle (certificate and/or key). */
  async importBundle(pemBundle: string, opts?: CallOptions): Promise<Record<string, unknown> | undefined> {
    const res = await this.client.write(this.path('config', 'ca'), { pem_bundle: pemBundle }, opts);
    return res?.data;
  }

  async deleteRoot(opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path('root'), opts);
  }

  // ------------------------------------------------------------ issuers & config

  async listIssuers(opts?: CallOptions & ListOptions) {
    return this.client.list<{ issuer_name: string; is_default: boolean; key_id: string }>(`${this.path('issuers')}/`, opts);
  }

  readIssuer(ref = 'default', opts?: CallOptions): Promise<Record<string, unknown>> {
    return getData(this.client, this.path('issuer', ref), opts);
  }

  async updateIssuer(ref: string, config: Record<string, unknown>, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('issuer', ref), compact(config), opts);
  }

  async setUrls(
    urls: { issuing_certificates?: string[]; crl_distribution_points?: string[]; ocsp_servers?: string[]; enable_templating?: boolean },
    opts?: CallOptions,
  ): Promise<void> {
    await this.client.write(this.path('config', 'urls'), compact(urls), opts);
  }

  readUrls(opts?: CallOptions): Promise<{ issuing_certificates: string[]; crl_distribution_points: string[]; ocsp_servers: string[] }> {
    return getData(this.client, this.path('config', 'urls'), opts);
  }

  async rotateCrl(opts?: CallOptions): Promise<void> {
    await this.client.read(this.path('crl', 'rotate'), opts);
  }

  async tidy(
    options: { tidy_cert_store?: boolean; tidy_revoked_certs?: boolean; tidy_expired_issuers?: boolean; safety_buffer?: Duration; [key: string]: unknown } = { tidy_cert_store: true, tidy_revoked_certs: true },
    opts?: CallOptions,
  ): Promise<void> {
    await this.client.write(this.path('tidy'), compact(options), opts);
  }
}
