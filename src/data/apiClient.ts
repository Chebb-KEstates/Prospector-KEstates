/**
 * The one door to the backend.
 *
 * Everything the app knows now comes through here. Three things matter:
 *
 *  1. `credentials: 'include'` — the session is an httpOnly cookie the JS
 *     cannot read. There is no token in localStorage to steal.
 *
 *  2. The CSRF token is read from a readable cookie and echoed in a header on
 *     every mutation (double-submit). The server rejects a mismatch.
 *
 *  3. Errors arrive as `{ error: { code, message } }` and become `ApiError`.
 *     `message` is written server-side to be shown to a user as-is, which is
 *     how the old signIn() strings survive unchanged.
 */

const BASE = process.env.REACT_APP_API_URL ?? 'http://localhost:4000';
const CSRF_COOKIE = 'prospector_csrf';
const CSRF_HEADER = 'x-csrf-token';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The caller's session is gone — the app should bounce to /login. */
  get isAuth(): boolean { return this.status === 401; }
  get isForbidden(): boolean { return this.status === 403; }
  get isViewCap(): boolean { return this.code === 'view_cap_reached'; }
  /** The row changed underneath us (e.g. a request already decided). */
  get isConflict(): boolean { return this.status === 409; }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Listeners for "you've been signed out" — AuthContext subscribes. */
type AuthLostHandler = () => void;
const authLostHandlers = new Set<AuthLostHandler>();
export function onAuthLost(handler: AuthLostHandler): () => void {
  authLostHandlers.add(handler);
  return () => authLostHandlers.delete(handler);
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Skip the sign-out broadcast on 401 (used by the session probe on boot). */
  quiet?: boolean;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(path.startsWith('http') ? path : `${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      // Skip empties so `?community=` doesn't become a filter for "".
      if (v == null || v === '' || (typeof v === 'boolean' && !v)) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Retry only what is safe to retry.
 *
 * GETs are idempotent, so a dropped connection or a 502 can be retried without
 * risk. Mutations are NEVER retried automatically: replaying "log this call" or
 * "approve this request" would double-write, and there are no idempotency keys.
 * A failed mutation surfaces to the user instead.
 */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const url = buildUrl(path, options.query);
  const isSafe = SAFE_METHODS.has(method);

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (!isSafe) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= (isSafe ? MAX_ATTEMPTS : 1); attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (err) {
      // Network-level failure (offline, DNS, connection reset).
      if ((err as Error).name === 'AbortError') throw err;
      lastError = new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
      if (isSafe && attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 300);
        continue;
      }
      throw lastError;
    }

    if (res.status === 204) return undefined as T;

    if (res.ok) {
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiError(res.status, 'bad_response', 'The server sent something unreadable.');
      }
    }

    if (RETRYABLE_STATUS.has(res.status) && isSafe && attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 300);
      continue;
    }

    const error = await toApiError(res);
    // A 401 anywhere means the session died (expired, or the account was
    // deactivated mid-session — which the server can now actually enforce).
    if (error.status === 401 && !options.quiet) {
      authLostHandlers.forEach(h => h());
    }
    throw error;
  }

  throw lastError ?? new ApiError(0, 'unknown', 'Something went wrong. Please try again.');
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = 'error';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;
  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // Non-JSON error body (a proxy's HTML 502 page, say) — keep the defaults.
  }
  return new ApiError(res.status, code, message, details);
}

export const get = <T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal) =>
  api<T>(path, { method: 'GET', query, signal });

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body });

export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body });

export const del = <T>(path: string) =>
  api<T>(path, { method: 'DELETE' });

/**
 * Multipart upload — the import wizard. Deliberately not routed through `api()`:
 * the browser must set its own multipart boundary, so we mustn't send a
 * content-type header.
 */
export async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);

  const headers: Record<string, string> = {};
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) headers[CSRF_HEADER] = csrf;

  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: form,
  });

  if (!res.ok) {
    const error = await toApiError(res);
    if (error.status === 401) authLostHandlers.forEach(h => h());
    throw error;
  }
  return res.json() as Promise<T>;
}

/** The caller's UTC offset in minutes, so the server's "today" matches theirs. */
export function tzOffsetMinutes(): number {
  // getTimezoneOffset() is minutes to ADD to local to reach UTC; the server
  // wants minutes to SUBTRACT from UTC to reach local, hence the negation.
  return -new Date().getTimezoneOffset();
}
