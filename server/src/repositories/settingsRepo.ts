import type { PoolConnection } from 'mysql2/promise';
import { pool, Row } from '../db/pool';
import { VaultSettings, kOrgId } from '../../../src/types/models';

/**
 * Platform rules — cooldown windows, attempt limits, the daily view cap.
 *
 * These aren't cosmetic: `applyOutcome` and the reveal cap both read them, so
 * this row is a security control, not a preferences blob. A missing row yields
 * `new VaultSettings()` — the same defaults the client fell back to.
 */
export async function loadSettings(cx?: PoolConnection): Promise<VaultSettings> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>('SELECT * FROM settings WHERE org_id = ? LIMIT 1', [kOrgId]);
  if (rows.length === 0) return new VaultSettings();
  const r = rows[0];
  return new VaultSettings(
    Number(r.not_interested_cooldown_days),
    Number(r.listed_cooldown_days),
    Number(r.max_no_answer_attempts),
    Number(r.assignment_expiry_days),
    Number(r.portfolio_stale_days),
    Number(r.daily_view_cap),
    !!r.wifi_lock_enabled,
    (r.office_ip as string) ?? '',
  );
}

export async function saveSettings(s: VaultSettings, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `INSERT INTO settings
       (org_id, not_interested_cooldown_days, listed_cooldown_days,
        max_no_answer_attempts, assignment_expiry_days, portfolio_stale_days,
        daily_view_cap, wifi_lock_enabled, office_ip, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       not_interested_cooldown_days = VALUES(not_interested_cooldown_days),
       listed_cooldown_days         = VALUES(listed_cooldown_days),
       max_no_answer_attempts       = VALUES(max_no_answer_attempts),
       assignment_expiry_days       = VALUES(assignment_expiry_days),
       portfolio_stale_days         = VALUES(portfolio_stale_days),
       daily_view_cap               = VALUES(daily_view_cap),
       wifi_lock_enabled            = VALUES(wifi_lock_enabled),
       office_ip                    = VALUES(office_ip),
       updated_at                   = VALUES(updated_at)`,
    [
      kOrgId,
      s.notInterestedCooldownDays, s.listedCooldownDays, s.maxNoAnswerAttempts,
      s.assignmentExpiryDays, s.portfolioStaleDays, s.dailyViewCap,
      s.wifiLockEnabled ? 1 : 0, s.officeIp, new Date(),
    ],
  );
}
