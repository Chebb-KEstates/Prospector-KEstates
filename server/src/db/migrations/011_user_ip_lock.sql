-- ═══════════════════════════════════════════════════════════════════════════
-- 011 — per-user office-network lock
--
-- The IP lock is now decided PER USER instead of one global switch: a broker
-- with ip_locked = 1 can only use the app from the office IP (settings.office_ip);
-- everyone else is unrestricted. Set on the Users screen. Defaults to 0 so no
-- one is locked until a manager turns it on for them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN ip_locked TINYINT NOT NULL DEFAULT 0;
