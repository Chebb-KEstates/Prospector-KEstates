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
  const d = new VaultSettings();
  return new VaultSettings(
    Number(r.not_interested_cooldown_days),
    Number(r.listed_cooldown_days),
    Number(r.max_no_answer_attempts),
    Number(r.assignment_expiry_days),
    Number(r.portfolio_stale_days),
    Number(r.daily_view_cap),
    !!r.wifi_lock_enabled,
    (r.office_ip as string) ?? '',
    // Coalesce to defaults so a settings row written before migration 004 (the
    // columns are NOT NULL DEFAULT, so this is belt-and-braces) still loads.
    r.assignment_sla_hours != null ? Number(r.assignment_sla_hours) : d.assignmentSlaHours,
    r.no_answer_extension_hours != null ? Number(r.no_answer_extension_hours) : d.noAnswerExtensionHours,
    r.no_answer_max_hold_days != null ? Number(r.no_answer_max_hold_days) : d.noAnswerMaxHoldDays,
    r.portfolio_renew_days != null ? Number(r.portfolio_renew_days) : d.portfolioRenewDays,
    r.expiring_soon_hours != null ? Number(r.expiring_soon_hours) : d.expiringSoonHours,
  );
}

export async function saveSettings(s: VaultSettings, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `INSERT INTO settings
       (org_id, not_interested_cooldown_days, listed_cooldown_days,
        max_no_answer_attempts, assignment_expiry_days, portfolio_stale_days,
        daily_view_cap, wifi_lock_enabled, office_ip,
        assignment_sla_hours, no_answer_extension_hours, no_answer_max_hold_days,
        portfolio_renew_days, expiring_soon_hours, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       not_interested_cooldown_days = VALUES(not_interested_cooldown_days),
       listed_cooldown_days         = VALUES(listed_cooldown_days),
       max_no_answer_attempts       = VALUES(max_no_answer_attempts),
       assignment_expiry_days       = VALUES(assignment_expiry_days),
       portfolio_stale_days         = VALUES(portfolio_stale_days),
       daily_view_cap               = VALUES(daily_view_cap),
       wifi_lock_enabled            = VALUES(wifi_lock_enabled),
       office_ip                    = VALUES(office_ip),
       assignment_sla_hours         = VALUES(assignment_sla_hours),
       no_answer_extension_hours    = VALUES(no_answer_extension_hours),
       no_answer_max_hold_days      = VALUES(no_answer_max_hold_days),
       portfolio_renew_days         = VALUES(portfolio_renew_days),
       expiring_soon_hours          = VALUES(expiring_soon_hours),
       updated_at                   = VALUES(updated_at)`,
    [
      kOrgId,
      s.notInterestedCooldownDays, s.listedCooldownDays, s.maxNoAnswerAttempts,
      s.assignmentExpiryDays, s.portfolioStaleDays, s.dailyViewCap,
      s.wifiLockEnabled ? 1 : 0, s.officeIp,
      s.assignmentSlaHours, s.noAnswerExtensionHours, s.noAnswerMaxHoldDays,
      s.portfolioRenewDays, s.expiringSoonHours, new Date(),
    ],
  );
}
