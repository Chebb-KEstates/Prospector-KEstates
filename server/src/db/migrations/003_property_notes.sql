-- Free-text notes a broker/manager keeps on a property (owner) record, edited
-- from the per-unit detail popup. Distinct from `assignment_note` (the manager's
-- note when handing the unit over) and from call-log notes (per call). Additive
-- and nullable; never written by import, so re-importing a dataset preserves it.
ALTER TABLE properties ADD COLUMN notes TEXT NULL AFTER assignment_note;
