import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { kOrgId } from '../../../src/types/models';
import { newNotificationId } from '../domain/ids';

/**
 * In-app notifications — what the bell in a broker's sidebar shows.
 *
 * `dedupeKey` makes sending idempotent: a second insert with the same
 * (user, key) is ignored, so a sweep that runs every 15 minutes sends each
 * notice once.
 */

export const NotificationKind = {
  /** Stage follow-up: this unit goes back to the pool in 24 hours without a call. */
  stageReclaimWarning: 'stageReclaimWarning',
} as const;
export type NotificationKind = typeof NotificationKind[keyof typeof NotificationKind];

export interface AppNotification {
  id: string;
  kind: string;
  propertyId?: string;
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
}

function toNotification(r: Row): AppNotification {
  return {
    id: r.id as string,
    kind: r.kind as string,
    propertyId: (r.property_id as string) ?? undefined,
    title: r.title as string,
    body: (r.body as string) ?? '',
    createdAt: fromDb(r.created_at)!,
    readAt: fromDb(r.read_at),
  };
}

/** Send a notice. Returns false when one with the same (user, key) already exists. */
export async function insertNotification(input: {
  userId: string; kind: NotificationKind; propertyId?: string;
  title: string; body: string; dedupeKey: string; at?: string;
}, cx?: PoolConnection): Promise<boolean> {
  const db = cx ?? pool;
  const [res] = await db.query(
    `INSERT IGNORE INTO notifications
       (id, org_id, user_id, kind, property_id, title, body, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newNotificationId(), kOrgId, input.userId, input.kind, input.propertyId ?? null,
      input.title.slice(0, 200), input.body.slice(0, 1000), input.dedupeKey.slice(0, 255),
      toDb(input.at ?? new Date().toISOString()),
    ],
  );
  return ((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/** A user's newest notices, plus how many are unread. */
export async function listNotifications(userId: string, limit = 50): Promise<{
  rows: AppNotification[]; unread: number;
}> {
  const [rows] = await pool.query<Row[]>(
    `SELECT id, kind, property_id, title, body, created_at, read_at FROM notifications
      WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [kOrgId, userId, limit],
  );
  const [count] = await pool.query<Row[]>(
    'SELECT COUNT(*) AS n FROM notifications WHERE org_id = ? AND user_id = ? AND read_at IS NULL',
    [kOrgId, userId],
  );
  return { rows: rows.map(toNotification), unread: Number(count[0].n) };
}

/** Mark the given notices (or all of them) read — only the caller's own. */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const params: unknown[] = [toDb(new Date().toISOString()), kOrgId, userId];
  let only = '';
  if (ids) {
    if (ids.length === 0) return 0;
    only = `AND id IN (${ids.map(() => '?').join(', ')})`;
    params.push(...ids);
  }
  const [res] = await pool.query(
    `UPDATE notifications SET read_at = ?
      WHERE org_id = ? AND user_id = ? AND read_at IS NULL ${only}`,
    params,
  );
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}
