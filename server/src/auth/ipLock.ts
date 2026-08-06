import { pool, Row } from '../db/pool';
import { kOrgId } from '../../../src/types/models';

/**
 * The office-network lock state, read on every request. Cached for a few seconds
 * so the per-request enforcement doesn't hit the database each time; a change to
 * the setting takes effect within the TTL, or immediately if the settings save
 * calls `clearIpLockCache()`.
 */

export interface IpLockState { wifiLockEnabled: boolean; officeIp: string }

let cache: { state: IpLockState; at: number } | null = null;
const TTL_MS = 10_000;

export async function getIpLock(): Promise<IpLockState> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.state;
  const [rows] = await pool.query<Row[]>(
    'SELECT wifi_lock_enabled, office_ip FROM settings WHERE org_id = ? LIMIT 1', [kOrgId],
  );
  const state: IpLockState = {
    wifiLockEnabled: rows.length ? !!rows[0].wifi_lock_enabled : false,
    officeIp: rows.length ? String(rows[0].office_ip ?? '') : '',
  };
  cache = { state, at: now };
  return state;
}

export function clearIpLockCache(): void { cache = null; }
