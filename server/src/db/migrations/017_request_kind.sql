-- What a request asks for:
--   'units'    — pooled units for the broker (the Pool tab, "Request this unit");
--   'takeover' — a unit that belongs to ANOTHER broker. Approving it moves the
--                unit (with that owner's other units in the same area) from its
--                current broker to the requester.
--
-- Additive: every existing request is a 'units' request, which is what they all
-- are. No other column or row changes.
ALTER TABLE requests ADD COLUMN kind ENUM('units','takeover') NOT NULL DEFAULT 'units' AFTER broker_id;
