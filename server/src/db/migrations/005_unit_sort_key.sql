-- Natural ordering for the unit column.
--
-- The default sort concatenated community|cluster|building|unit into one string
-- and compared it as text, so a vault read "Unit 1, Unit 10, Unit 100, Unit 2"
-- and "Maple 1, Maple 10, Maple 2". Correct for a computer, unusable for a human
-- scanning a list of units.
--
-- Sorting by expression fixes the order but not the cost: the regex has to run
-- for every candidate row on every page, which measured 5-11x slower than the
-- old string sort on a 60k-row table (60ms -> 293-656ms). So the key is computed
-- ONCE here, at write time, and indexed — ordering becomes an index scan and
-- ends up faster than the string sort it replaces.
--
-- Shape of the key, per part (community, cluster, building, unit-or-plot):
--   <letters with digits stripped> | <first run of digits, zero-padded to 10>
-- Zero-padding is what makes a text comparison order numbers correctly, and the
-- letters-first ordering keeps "Maple 2" ahead of "Maple 10" while leaving mixed
-- formats like "12A" and "G-01" deterministic. Parts are truncated (40/24 chars)
-- purely to keep the index inside InnoDB's key-length limit; `id` breaks any
-- remaining tie, so pagination can never repeat or skip a row.
--
-- STORED (not VIRTUAL) so it can be indexed, and maintained by MySQL itself —
-- imports and updates need no application change.
ALTER TABLE properties
  ADD COLUMN unit_sort_key VARCHAR(200) GENERATED ALWAYS AS (
    CONCAT_WS('|',
      LEFT(REGEXP_REPLACE(community, '[0-9]+', ''), 40),
      LPAD(IFNULL(REGEXP_SUBSTR(community, '[0-9]+'), '0'), 10, '0'),
      LEFT(REGEXP_REPLACE(IFNULL(cluster, ''), '[0-9]+', ''), 40),
      LPAD(IFNULL(REGEXP_SUBSTR(IFNULL(cluster, ''), '[0-9]+'), '0'), 10, '0'),
      LEFT(REGEXP_REPLACE(IFNULL(building, ''), '[0-9]+', ''), 40),
      LPAD(IFNULL(REGEXP_SUBSTR(IFNULL(building, ''), '[0-9]+'), '0'), 10, '0'),
      LEFT(REGEXP_REPLACE(IFNULL(unit_number, IFNULL(plot_number, '')), '[0-9]+', ''), 24),
      LPAD(IFNULL(REGEXP_SUBSTR(IFNULL(unit_number, IFNULL(plot_number, '')), '[0-9]+'), '0'), 10, '0')
    )
  ) STORED;

-- Seek by org, then read straight out in sort order — no filesort. InnoDB
-- appends the primary key, so the `id` tiebreaker is covered too.
CREATE INDEX ix_prop_unit_sort ON properties (org_id, unit_sort_key);
