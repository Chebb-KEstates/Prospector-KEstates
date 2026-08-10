-- ═══════════════════════════════════════════════════════════════════════════
-- 012 — drop the dead daily-view-cap and global-lock columns
--
-- The daily view cap was removed for everyone, and the global Wi-Fi/office lock
-- was replaced by a per-user switch (`users.ip_locked`, migration 011). These
-- three columns are no longer read or written by any code:
--   settings.daily_view_cap        (cap removed)
--   settings.wifi_lock_enabled     (global lock removed; per-user now)
--   users.view_cap_override        (per-user cap removed)
-- None carry an index or constraint, so dropping them is a clean removal.
-- Forward-only; runs once (recorded in schema_migrations).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE settings
  DROP COLUMN daily_view_cap,
  DROP COLUMN wifi_lock_enabled;

ALTER TABLE users
  DROP COLUMN view_cap_override;
