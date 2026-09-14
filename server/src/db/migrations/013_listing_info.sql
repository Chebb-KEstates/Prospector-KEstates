-- Listing information captured when a unit is interested (the record popup's
-- "Information" section): the asking price when interested to sell, the asking
-- rent when interested to lease, and free-text listing notes. Additive and
-- nullable; never written by import, so re-importing a dataset preserves them.
-- Distinct from `notes` (general record notes) and `last_transaction_value`
-- (the historical sale price from the data), which they do not touch.
ALTER TABLE properties ADD COLUMN asking_price DOUBLE NULL AFTER notes;
ALTER TABLE properties ADD COLUMN asking_rent  DOUBLE NULL AFTER asking_price;
ALTER TABLE properties ADD COLUMN listing_note TEXT   NULL AFTER asking_rent;
