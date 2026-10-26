-- In-app notifications — the bell in a broker's sidebar.
--
-- First use: the stage follow-up reminder, sent to a unit's broker at least 24
-- hours before the unit would go back to the pool for lack of calls. The
-- reclaim waits until that reminder is a full 24 hours old, so nobody loses a
-- unit without notice.
--
-- `dedupe_key` makes a notice idempotent: the sweep runs every 15 minutes, and
-- one reminder per unit per idle period is the rule. `read_at` NULL = unread.
-- Additive: a new table; nothing else changes.
CREATE TABLE IF NOT EXISTS notifications (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id      VARCHAR(64)  NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  kind        VARCHAR(32)  NOT NULL,
  property_id VARCHAR(64)  NULL,
  title       VARCHAR(200) NOT NULL,
  body        VARCHAR(1000) NOT NULL DEFAULT '',
  dedupe_key  VARCHAR(255) NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  read_at     DATETIME(3)  NULL,
  UNIQUE KEY ux_notif_dedupe (user_id, dedupe_key),
  KEY ix_notif_user (user_id, created_at),
  KEY ix_notif_property (property_id, kind, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
