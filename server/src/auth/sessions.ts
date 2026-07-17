import { randomBytes, createHash } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { pool, Row } from '../db/pool';
import { env } from '../config/env';

/**
 * Server-side sessions in MySQL.
 *
 * The reference implementation kept the signed-in user's *id* in sessionStorage
 * and trusted it on reload — i.e. the client asserted who it was. Here the
 * client holds an opaque random token in an httpOnly cookie it cannot read, and
 * the server holds the mapping. Two consequences that matter:
 *
 *  - Only a SHA-256 of the token is stored, so a database dump doesn't hand an
 *    attacker live sessions.
 *  - Deactivating a user can actually terminate their sessions (`revokeAllFor`),
 *    which the client-side version could never do — AuthContext.refreshFrom was
 *    written for this and then never called.
 */

export const SESSION_COOKIE = 'prospector_session';
export const CSRF_COOKIE = 'prospector_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface SessionRecord {
  userId: string;
  csrfToken: string;
  expiresAt: Date;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface NewSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
  cx?: PoolConnection,
): Promise<NewSession> {
  const db = cx ?? pool;
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.sessionTtlHours * 3600_000);

  await db.query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hashToken(token), userId, csrfToken, now, now, expiresAt,
      meta.userAgent?.slice(0, 255) ?? null,
      meta.ip?.slice(0, 64) ?? null,
    ],
  );

  return { token, csrfToken, expiresAt };
}

/**
 * Look up a live session. Expired rows are treated as absent and swept lazily.
 * Also slides `last_seen_at` so an active user isn't logged out mid-session.
 */
export async function readSession(token: string): Promise<SessionRecord | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT user_id, csrf_token, expires_at FROM sessions
     WHERE token_hash = ? AND expires_at > NOW(3) LIMIT 1`,
    [hashToken(token)],
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  // Fire-and-forget touch: never block a request on session bookkeeping.
  pool
    .query('UPDATE sessions SET last_seen_at = NOW(3) WHERE token_hash = ?', [hashToken(token)])
    .catch(() => { /* touch is best-effort */ });

  return {
    userId: r.user_id as string,
    csrfToken: r.csrf_token as string,
    expiresAt: r.expires_at as Date,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

/** Used when a user is deactivated, or changes their password. */
export async function revokeAllFor(userId: string, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

/** Housekeeping — called on a timer by the server. */
export async function sweepExpiredSessions(): Promise<number> {
  const [res] = await pool.query('DELETE FROM sessions WHERE expires_at <= NOW(3)');
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
    expires: expiresAt,
  };
}

/**
 * The CSRF cookie is deliberately readable by JS: it's the "double submit"
 * half. The session cookie stays httpOnly; a cross-site attacker can cause the
 * browser to send it, but cannot read this value to echo it back in the header.
 */
export function csrfCookieOptions(expiresAt: Date) {
  return {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
    expires: expiresAt,
  };
}
