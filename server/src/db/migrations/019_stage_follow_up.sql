-- Stage follow-up: how long an ASSIGNED unit may sit in a stage without its
-- broker logging a call on it before it goes back to the pool (unassigned).
--   Prospecting 30 days · Market appraisal 14 days · Listed offline 7 days.
-- None and Listed online have no such rule. 0 switches a stage's rule off.
-- Adjustable under Settings → Stage follow-up.
--
-- Additive: three columns with those defaults. No unit changes here; the
-- server's housekeeping sweep applies the rule from its next run.
ALTER TABLE settings
  ADD COLUMN stage_idle_prospecting_days INT NOT NULL DEFAULT 30,
  ADD COLUMN stage_idle_appraisal_days   INT NOT NULL DEFAULT 14,
  ADD COLUMN stage_idle_offline_days     INT NOT NULL DEFAULT 7;
