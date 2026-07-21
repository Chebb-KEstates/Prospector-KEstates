-- Assignment timer: a per-unit countdown that recycles neglected units.
--
-- `assignment_expires_at` is the single source of truth for the countdown shown
-- in the tables and for the housekeeping sweep that returns a lapsed unit to the
-- pool. It is non-null only while a unit is `assigned` or `portfolio`.
ALTER TABLE properties ADD COLUMN assignment_expires_at DATETIME(3) NULL AFTER next_follow_up_at;
ALTER TABLE leads ADD COLUMN assignment_expires_at DATETIME(3) NULL AFTER next_follow_up_at;

-- Sweep queries filter by (org, state, deadline); index that access path.
CREATE INDEX ix_prop_expires ON properties (org_id, state, assignment_expires_at);
CREATE INDEX ix_lead_expires ON leads (org_id, state, assignment_expires_at);

-- Manager-configurable timer windows. Hours for the fast SLA / rolling window,
-- days for the hard cap, the portfolio renewal, and the "expiring soon" alert.
ALTER TABLE settings
  ADD COLUMN assignment_sla_hours      INT NOT NULL DEFAULT 48,
  ADD COLUMN no_answer_extension_hours INT NOT NULL DEFAULT 24,
  ADD COLUMN no_answer_max_hold_days   INT NOT NULL DEFAULT 14,
  ADD COLUMN portfolio_renew_days      INT NOT NULL DEFAULT 7,
  ADD COLUMN expiring_soon_hours       INT NOT NULL DEFAULT 24;

-- Backfill so units already held on deploy get a fresh window instead of
-- instantly expiring the moment the sweep next runs.
--
-- UTC_TIMESTAMP, not NOW(): every DATETIME here is written by the app as UTC
-- (the pool is opened with timezone 'Z'), so NOW() would seed deadlines shifted
-- by the database server's local UTC offset.
UPDATE properties SET assignment_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 48 HOUR) WHERE state = 'assigned';
UPDATE properties SET assignment_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY) WHERE state = 'portfolio';
UPDATE leads SET assignment_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 48 HOUR) WHERE state = 'assigned';
UPDATE leads SET assignment_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY) WHERE state = 'portfolio';
