-- ═══════════════════════════════════════════════════════════════════════════
-- 010 — drop community + sub-community from the unit identity key
--
-- A unit is now identified by its number (plot, or unit-within-building), NOT by
-- its master community / sub-community — those are correctable labels. This makes
-- the UNIQUE (org_id, unit_key_hash) index a real duplicate guard: changing a
-- community on a later upload now matches the existing unit instead of minting a
-- second row with a different key.
--
-- The stored segments were already normalised at import, so a pure string edit
-- reproduces exactly what the new unitKeyFor() builds:
--   u|community|cluster|building|unit  ->  u|building|unit   (keep 4th + last)
--   p|community|plot                   ->  p|plot            (keep last)
--
-- Guarded by pipe count so it only touches old-format keys (idempotent): a new
-- 'u|building|unit' has 2 pipes and won't match 'u|%|%|%|%'.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE properties
   SET unit_key = CONCAT('u|',
     SUBSTRING_INDEX(SUBSTRING_INDEX(unit_key, '|', 4), '|', -1), '|',
     SUBSTRING_INDEX(unit_key, '|', -1))
 WHERE unit_key LIKE 'u|%|%|%|%';

UPDATE properties
   SET unit_key = CONCAT('p|', SUBSTRING_INDEX(unit_key, '|', -1))
 WHERE unit_key LIKE 'p|%|%';
