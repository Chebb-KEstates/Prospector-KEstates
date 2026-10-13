-- The listing journey stage of a unit, set by hand from the record popup:
-- None → Prospecting → Market appraisal → Listed offline → Listed online.
--
-- Independent of `state` (the calling lifecycle) and of call outcomes. Like
-- `notes`, it is written only by its own endpoint and is NOT in the import /
-- call-logging upsert, so re-importing a dataset or logging a call never resets
-- it. The ENUM order is the journey order, so ORDER BY stage sorts naturally.
--
-- Additive: every existing unit gets 'none'. No other column or row changes.
ALTER TABLE properties ADD COLUMN stage
  ENUM('none','prospecting','marketAppraisal','listedOffline','listedOnline')
  NOT NULL DEFAULT 'none' AFTER listing_note;

-- The table's Stage filter: (org, stage), the same shape as the state index.
CREATE INDEX ix_prop_stage ON properties (org_id, stage);
