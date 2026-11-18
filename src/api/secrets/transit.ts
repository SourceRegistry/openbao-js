import type { OpenBaoCore } from '../../core.js';
import type { CallOptions, Duration, ListOptions } from '../../types.js';
import { compact, fromBase64, fromBase64String, toBase64 } from '../../utils.js';
import { MountedApi, postData } from '../base.js';

/** Plaintext input: strings are UTF-8 encoded, bytes are used as-is. Base64 encoding is handled for you. */
export type BinaryLike = string | Uint8Array;

export type TransitKeyType =
  | 'aes128-gcm96'
  | 'aes256-gcm96'
  | 'chacha20-poly1305'
  | 'xchacha20-poly1305'
  | 'ed25519'
  | 'ecdsa-p256'
  | 'ecdsa-p384'
  | 'ecdsa-p521'
  | 'rsa-2048'
  | 'rsa-3072'
  | 'rsa-4096'
  | 'hmac'
  | (string & {});

export type HashAlgorithm =
  | 'sha1'
  | 'sha2-224'
  | 'sha2-256'
  | 'sha2-384'
  | 'sha2-512'
  | 'sha3-224'
  | 'sha3-256'
  | 'sha3-384'
  | 'sha3-512'
  | 'none';

export interface CreateTransitKeyOptions {
  type?: TransitKeyType;
  derived?: boolean;
  convergent_encryption?: boolean;
  exportable?: boolean;
  allow_plaintext_backup?: boolean;
  auto_rotate_period?: Duration;
  key_size?: number;
  [key: string]: unknown;
}

export interface TransitKeyConfig {
  min_decryption_version?: number;
  min_encryption_version?: number;
  deletion_allowed?: boolean;
  exportable?: boolean;
  allow_plaintext_backup?: boolean;
  auto_rotate_period?: Duration;
}

export interface TransitKey {
  name: string;
  type: string;
  derived: boolean;
  deletion_allowed: boolean;
  exportable: boolean;
  allow_plaintext_backup: boolean;
  supports_encryption: boolean;
  supports_decryption: boolean;
  supports_derivation: boolean;
  supports_signing: boolean;
  latest_version: number;
  min_available_version: number;
  min_decryption_version: number;
  min_encryption_version: number;
  auto_rotate_period: number;
  /** Version → creation timestamp (symmetric) or public key info (asymmetric). */
  keys: Record<string, number | { creation_time: string; name: string; public_key: string }>;
  [key: string]: unknown;
}

export interface EncryptOptions extends CallOptions {
  /** Key-derivation context (required for derived keys). */
  context?: BinaryLike;
  keyVersion?: number;
  nonce?: string;
  associatedData?: BinaryLike;
}

export interface DecryptOptions extends CallOptions {
  context?: BinaryLike;
  nonce?: string;
  associatedData?: BinaryLike;
}

export interface BatchEncryptItem {
  plaintext: BinaryLike;
  context?: BinaryLike;
  reference?: string;
}

export interface BatchDecryptItem {
  ciphertext: string;
  context?: BinaryLike;
  reference?: string;
}

export interface BatchResult {
  ciphertext?: string;
  plaintext?: string;
  key_version?: number;
  reference?: string;
  error?: string;
}

export interface SignOptions extends CallOptions {
  hashAlgorithm?: HashAlgorithm;
  keyVersion?: number;
  context?: BinaryLike;
  prehashed?: boolean;
  signatureAlgorithm?: 'pss' | 'pkcs1v15';
  marshalingAlgorithm?: 'asn1' | 'jws';
  saltLength?: 'auto' | 'hash' | number;
}

const b64 = (v: BinaryLike | undefined) => (v === undefined ? undefined : toBase64(v));

/** Transit — encryption as a service. */
export class Transit extends MountedApi {
  constructor(client: OpenBaoCore, mount = 'transit') {
    super(client, mount);
  }

  // ------------------------------------------------------------ keys

  async createKey(name: string, options: CreateTransitKeyOptions = {}, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('keys', name), compact(options), opts);
  }

  async readKey(name: string, opts?: CallOptions): Promise<TransitKey> {
    return (await this.client.read<TransitKey>(this.path('keys', name), opts)).data;
  }

  async listKeys(opts?: CallOptions & ListOptions): Promise<string[]> {
    return (await this.client.list(`${this.path('keys')}/`, opts)).keys;
  }

  /** Deletes a key. The key must have `deletion_allowed: true` (see {@link configureKey}). */
  async deleteKey(name: string, opts?: CallOptions): Promise<void> {
    await this.client.delete(this.path('keys', name), opts);
  }

  async configureKey(name: string, config: TransitKeyConfig, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('keys', name, 'config'), compact(config), opts);
  }

  async rotateKey(name: string, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('keys', name, 'rotate'), {}, opts);
  }

  async trimKey(name: string, minAvailableVersion: number, opts?: CallOptions): Promise<void> {
    await this.client.write(this.path('keys', name, 'trim'), { min_available_version: minAvailableVersion }, opts);
  }

  async exportKey(
    name: string,
    type: 'encryption-key' | 'signing-key' | 'hmac-key' | 'public-key',
    version?: number | 'latest',
    opts?: CallOptions,
  ): Promise<{ name: string; type: string; keys: Record<string, string> }> {
    return (await this.client.read<{ name: string; type: string; keys: Record<string, string> }>(this.path('export', type, name, version), opts)).data;
  }

  async backupKey(name: string, opts?: CallOptions): Promise<string> {
    return (await this.client.read<{ backup: string }>(this.path('backup', name), opts)).data.backup;
  }

  async restoreKey(backup: string, options: { name?: string; force?: boolean } & CallOptions = {}): Promise<void> {
    const { name, force, ...opts } = options;
    await this.client.write(this.path('restore', name), compact({ backup, force }), opts);
  }

  // ------------------------------------------------------------ encryption

  /** Encrypts `plaintext` and returns the `bao:v1:...` ciphertext. */
  async encrypt(key: string, plaintext: BinaryLike, options: EncryptOptions = {}): Promise<string> {
    const { context, keyVersion, nonce, associatedData, ...opts } = options;
    const res = await postData<{ ciphertext: string }>(this.client, 
      this.path('encrypt', key),
      compact({ plaintext: toBase64(plaintext), context: b64(context), key_version: keyVersion, nonce, associated_data: b64(associatedData) }),
      opts,
    );
    return res.ciphertext;
  }

  /** Decrypts to a UTF-8 string. Use {@link decryptBytes} for binary data. */
  async decrypt(key: string, ciphertext: string, options: DecryptOptions = {}): Promise<string> {
    return fromBase64String(await this.decryptRaw(key, ciphertext, options));
  }

  /** Decrypts to raw bytes. */
  async decryptBytes(key: string, ciphertext: string, options: DecryptOptions = {}): Promise<Uint8Array> {
    return fromBase64(await this.decryptRaw(key, ciphertext, options));
  }

  /** Re-encrypts ciphertext with the latest (or given) key version without exposing plaintext. */
  async rewrap(key: string, ciphertext: string, options: { context?: BinaryLike; keyVersion?: number; nonce?: string } & CallOptions = {}): Promise<string> {
    const { context, keyVersion, nonce, ...opts } = options;
    const res = await postData<{ ciphertext: string }>(this.client, 
      this.path('rewrap', key),
      compact({ ciphertext, context: b64(context), key_version: keyVersion, nonce }),
      opts,
    );
    return res.ciphertext;
  }

  /** Encrypts many items in one request. Per-item failures are reported in `error`. */
  async encryptBatch(key: string, items: BatchEncryptItem[], options: { keyVersion?: number } & CallOptions = {}): Promise<BatchResult[]> {
    const { keyVersion, ...opts } = options;
    const batch_input = items.map((i) => compact({ plaintext: toBase64(i.plaintext), context: b64(i.context), reference: i.reference }));
    const res = await postData<{ batch_results: BatchResult[] }>(this.client, this.path('encrypt', key), compact({ batch_input, key_version: keyVersion }), opts);
    return res.batch_results;
  }

  /** Decrypts many items in one request. `plaintext` in results is decoded to UTF-8. */
  async decryptBatch(key: string, items: BatchDecryptItem[], opts?: CallOptions): Promise<BatchResult[]> {
    const batch_input = items.map((i) => compact({ ciphertext: i.ciphertext, context: b64(i.context), reference: i.reference }));
    const res = await postData<{ batch_results: BatchResult[] }>(this.client, this.path('decrypt', key), { batch_input }, opts);
    return res.batch_results.map((r) =>
      r.plaintext !== undefined ? { ...r, plaintext: fromBase64String(r.plaintext) } : r,
    );
  }

  /**
   * Generates a data key for envelope encryption. `plaintext` (base64) is only
   * returned for `type: 'plaintext'`.
   */
  async generateDataKey(
    key: string,
    options: { type?: 'plaintext' | 'wrapped'; bits?: 128 | 256 | 512; context?: BinaryLike; nonce?: string } & CallOptions = {},
  ): Promise<{ ciphertext: string; plaintext?: string; key_version: number }> {
    const { type = 'plaintext', bits, context, nonce, ...opts } = options;
    const res = await postData<{ ciphertext: string; plaintext?: string; key_version: number }>(this.client, 
      this.path('datakey', type, key),
      compact({ bits, context: b64(context), nonce }),
      opts,
    );
    return res;
  }

  // ------------------------------------------------------------ signing / hmac

  async sign(key: string, input: BinaryLike, options: SignOptions = {}): Promise<string> {
    const { hashAlgorithm, keyVersion, context, prehashed, signatureAlgorithm, marshalingAlgorithm, saltLength, ...opts } = options;
    const res = await postData<{ signature: string }>(this.client, 
      this.path('sign', key),
      compact({
        input: toBase64(input),
        hash_algorithm: hashAlgorithm,
        key_version: keyVersion,
        context: b64(context),
        prehashed,
        signature_algorithm: signatureAlgorithm,
        marshaling_algorithm: marshalingAlgorithm,
        salt_length: saltLength,
      }),
      opts,
    );
    return res.signature;
  }

  async verify(key: string, input: BinaryLike, signature: string, options: Omit<SignOptions, 'keyVersion'> = {}): Promise<boolean> {
    const { hashAlgorithm, context, prehashed, signatureAlgorithm, marshalingAlgorithm, saltLength, ...opts } = options;
    const res = await postData<{ valid: boolean }>(this.client, 
      this.path('verify', key),
      compact({
        input: toBase64(input),
        signature,
        hash_algorithm: hashAlgorithm,
        context: b64(context),
        prehashed,
        signature_algorithm: signatureAlgorithm,
        marshaling_algorithm: marshalingAlgorithm,
        salt_length: saltLength,
      }),
      opts,
    );
    return res.valid;
  }

  async hmac(key: string, input: BinaryLike, options: { algorithm?: HashAlgorithm; keyVersion?: number } & CallOptions = {}): Promise<string> {
    const { algorithm, keyVersion, ...opts } = options;
    const res = await postData<{ hmac: string }>(this.client, 
      this.path('hmac', key),
      compact({ input: toBase64(input), algorithm, key_version: keyVersion }),
      opts,
    );
    return res.hmac;
  }

  async verifyHmac(key: string, input: BinaryLike, hmac: string, options: { algorithm?: HashAlgorithm } & CallOptions = {}): Promise<boolean> {
    const { algorithm, ...opts } = options;
    const res = await postData<{ valid: boolean }>(this.client, this.path('verify', key), compact({ input: toBase64(input), hmac, algorithm }), opts);
    return res.valid;
  }

  // ------------------------------------------------------------ utilities

  async random(bytes = 32, options: { format?: 'base64' | 'hex'; source?: 'platform' | 'seal' | 'all' } & CallOptions = {}): Promise<string> {
    const { format, source, ...opts } = options;
    const res = await postData<{ random_bytes: string }>(this.client, this.path('random', source, bytes), compact({ format }), opts);
    return res.random_bytes;
  }

  async hash(input: BinaryLike, options: { algorithm?: Exclude<HashAlgorithm, 'none'>; format?: 'hex' | 'base64' } & CallOptions = {}): Promise<string> {
    const { algorithm, format, ...opts } = options;
    const res = await postData<{ sum: string }>(this.client, this.path('hash', algorithm), compact({ input: toBase64(input), format }), opts);
    return res.sum;
  }

  private async decryptRaw(key: string, ciphertext: string, options: DecryptOptions): Promise<string> {
    const { context, nonce, associatedData, ...opts } = options;
    const res = await postData<{ plaintext: string }>(this.client, 
      this.path('decrypt', key),
      compact({ ciphertext, context: b64(context), nonce, associated_data: b64(associatedData) }),
      opts,
    );
    return res.plaintext;
  }
}
