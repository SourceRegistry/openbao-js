import type { Query } from './types.js';

/** Strips leading/trailing slashes. */
export function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

/**
 * Joins path segments into an API path, URL-encoding each segment while
 * preserving `/` separators inside segments (secret paths are hierarchical).
 */
export function joinPath(...segments: Array<string | number | undefined>): string {
  return segments
    .filter((s): s is string | number => s !== undefined && s !== '')
    .map((s) =>
      trimSlashes(String(s))
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join('/'),
    )
    .filter(Boolean)
    .join('/');
}

/** Like {@link joinPath} but keeps a trailing slash on the final segment (folder semantics for LIST). */
export function joinFolder(...segments: Array<string | number | undefined>): string {
  const p = joinPath(...segments);
  return p.endsWith('/') ? p : `${p}/`;
}

export function buildQuery(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Removes `undefined` properties so they are not serialized. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Base64-encodes a UTF-8 string or raw bytes (works in Node, Deno, Bun and browsers). */
export function toBase64(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decodes base64 into bytes. */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decodes base64 into a UTF-8 string. */
export function fromBase64String(b64: string): string {
  return decoder.decode(fromBase64(b64));
}

export function readEnv(...names: string[]): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (!env) return undefined;
  for (const n of names) {
    const v = env[n];
    if (v) return v;
  }
  return undefined;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
