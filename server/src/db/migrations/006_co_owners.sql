-- Co-owners: a unit can be owned by more than one person, and the vendor's
-- ownership register lists each owner on their OWN row (same unit, different
-- Owner Name + Mobile + Nationality). The register import used to collapse those
-- rows to the last owner; now every owner is kept.
--
-- `owners` is a JSON array [{name, phone, nationality, phones:[{label,number}]}].
-- NULL means a single owner — the existing owner_name / owner_phone /
-- owner_nationality / owner_phones columns still hold the PRIMARY owner
-- (owners[0]), so masking, ownerKeyOf, the generated `callable` column, search
-- and the current table keep working untouched. Only co-owned units populate it.
-- Same rationale as owner_phones (migration 002): a JSON column, not a table.
ALTER TABLE properties ADD COLUMN owners JSON NULL AFTER owner_phones;

-- Which owner a call's feedback was about, so a co-owned unit's history reads
-- "Feedback on Ahmed Khan: …" rather than attributing it to the whole unit.
ALTER TABLE calls ADD COLUMN owner_name VARCHAR(255) NULL AFTER note;
