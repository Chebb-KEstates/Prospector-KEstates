import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * One shared connection pool.
 *
 * `timezone: 'Z'` matters: the domain layer speaks ISO-8601 UTC strings
 * everywhere, and DATETIME(3) columns are written/read as UTC so a server in
 * any timezone produces identical timestamps. Without this, `lastCalledAt`
 * would shift and the cooldown maths would drift.
 */
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  timezone: 'Z',
  charset: 'utf8mb4_unicode_ci',
  supportBigNumbers: true,
  dateStrings: false,
  multipleStatements: false,
});

export type Row = mysql.RowDataPacket;

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(
  fn: (cx: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const out = await fn(cx);
    await cx.commit();
    return out;
  } catch (err) {
    try { await cx.rollback(); } catch { /* connection already gone */ }
    throw err;
  } finally {
    cx.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** ISO-8601 string ⇄ MySQL DATETIME(3). The domain layer only ever sees ISO. */
export function toDb(iso?: string | null): Date | null {
  if (iso == null || iso.length === 0) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function fromDb(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v.toISOString();
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
