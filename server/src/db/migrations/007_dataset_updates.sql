-- ═══════════════════════════════════════════════════════════════════════════
-- 007 — track updates to a data set without creating a second data set
--
-- An "update" import merges a refreshed file into an EXISTING data set (matched
-- by unit_key). Until now refreshDatasetStats() overwrote `imported_at` with the
-- refresh time, losing the original import date. Split the two:
--   • imported_at   stays the ORIGINAL import date (never touched by an update)
--   • last_updated_at  = when the set was last refreshed (NULL until first update)
--   • update_count      = how many times it has been refreshed
-- so the Data Sets list shows one row that was updated, and when.
--
-- Additive and backfill-free: existing sets get last_updated_at = NULL,
-- update_count = 0 (i.e. "never updated since import").
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE datasets
  ADD COLUMN last_updated_at DATETIME(3) NULL AFTER imported_by;

ALTER TABLE datasets
  ADD COLUMN update_count INT NOT NULL DEFAULT 0 AFTER last_updated_at;
