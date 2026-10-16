-- Switch every cooldown / timer / alert on the Settings screen OFF (0).
--
-- 0 means "this rule does not run" (see dispositions.ts holdTimerOn /
-- cooldownTimerOn / isPortfolioStale):
--   not_interested_cooldown_days, listed_cooldown_days — a not-interested /
--     already-listed unit is not returned to the pool automatically;
--   portfolio_stale_days — no interested unit is flagged stale;
--   assignment_sla_hours, no_answer_extension_hours, no_answer_max_hold_days,
--   portfolio_renew_days — no countdown, no unit released from its broker;
--   expiring_soon_hours — no "running out of time" warning.
--
-- Only the one settings row changes. No unit is touched: deadlines already
-- stored on units are kept (and ignored while their timer is off), so raising a
-- value again later simply resumes them. The values can be changed back at any
-- time from Settings.
UPDATE settings SET
  not_interested_cooldown_days = 0,
  listed_cooldown_days = 0,
  portfolio_stale_days = 0,
  assignment_sla_hours = 0,
  no_answer_extension_hours = 0,
  no_answer_max_hold_days = 0,
  portfolio_renew_days = 0,
  expiring_soon_hours = 0;
