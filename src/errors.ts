/**
 * Thrown when OpenBao answers with a non-success HTTP status.
 *
 * OpenBao reports failures as `{ "errors": ["message", ...] }`; those messages
 * are exposed on {@link OpenBaoError.errors} and joined into `message`.
 */
export class OpenBaoError extends Error {
  override readonly name: string = 'OpenBaoError';
  /** HTTP status code returned by the server. */
  readonly status: number;
  /** Error messages from the response body's `errors` array. */
  readonly errors: string[];
  /** Warnings returned alongside the error, if any. */
  readonly warnings: string[];
  /** HTTP method of the failed request. */
  readonly method: string;
  /** API path of the failed request (relative to `/v1/`). */
  readonly path: string;
  /** Parsed response body (or raw text when it was not JSON). */
  readonly body: unknown;

  constructor(init: {
    status: number;
    method: string;
    path: string;
    errors?: string[];
    warnings?: string[];
    body?: unknown;
  }) {
    const detail = init.errors?.length ? init.errors.join('; ') : `HTTP ${init.status}`;
    super(`${init.method} /v1/${init.path} failed (${init.status}): ${detail}`);
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.errors = init.errors ?? [];
    this.warnings = init.warnings ?? [];
    this.body = init.body;
  }

  /** `true` for 404 Not Found — e.g. reading a secret that does not exist. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** `true` for 403 Forbidden — missing/invalid token or insufficient policy. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** `true` when the server reports it is sealed (503 + "sealed" message). */
  get isSealed(): boolean {
    return this.status === 503 && this.errors.some((e) => /sealed/i.test(e));
  }
}

/** Thrown when a request could not be completed (network failure, timeout, abort). */
export class OpenBaoConnectionError extends Error {
  override readonly name: string = 'OpenBaoConnectionError';
  readonly method: string;
  readonly path: string;
  /** `true` when the request was aborted because the configured timeout elapsed. */
  readonly timedOut: boolean;

  constructor(init: { method: string; path: string; cause: unknown; timedOut?: boolean }) {
    const reason = init.timedOut
      ? 'request timed out'
      : init.cause instanceof Error
        ? init.cause.message
        : String(init.cause);
    super(`${init.method} /v1/${init.path} failed: ${reason}`, { cause: init.cause });
    this.method = init.method;
    this.path = init.path;
    this.timedOut = init.timedOut ?? false;
  }
}

/** Type guard for {@link OpenBaoError}. */
export function isOpenBaoError(err: unknown): err is OpenBaoError {
  return err instanceof OpenBaoError;
}

/** `true` when `err` is an {@link OpenBaoError} with status 404. */
export function isNotFound(err: unknown): boolean {
  return err instanceof OpenBaoError && err.status === 404;
}
