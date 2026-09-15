-- 014_text_requested_outcome.sql
-- Adds the new 'textRequested' call outcome to the three ENUM columns that store
-- outcomes (properties.last_outcome, leads.last_outcome, calls.outcome).
--
-- "Text requested" = the owner answered but asked to continue over text rather
-- than talk now. It is NOT an interest decision; the unit stays in play, to be
-- updated once the texting yields more information.
--
-- Additive only: every existing value stays valid and no row changes. Re-running
-- is safe — MODIFY sets each column to the same definition. Nullability is
-- preserved (last_outcome NULL, calls.outcome NOT NULL).

ALTER TABLE properties MODIFY COLUMN last_outcome
  ENUM('noAnswer','unreachable','callbackLater','textRequested','interestedSell',
       'interestedRent','notInterested','alreadyListed','dnc') NULL;

ALTER TABLE leads MODIFY COLUMN last_outcome
  ENUM('noAnswer','unreachable','callbackLater','textRequested','interestedSell',
       'interestedRent','notInterested','alreadyListed','dnc') NULL;

ALTER TABLE calls MODIFY COLUMN outcome
  ENUM('noAnswer','unreachable','callbackLater','textRequested','interestedSell',
       'interestedRent','notInterested','alreadyListed','dnc') NOT NULL;
