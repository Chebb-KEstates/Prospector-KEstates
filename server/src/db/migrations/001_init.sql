-- ═══════════════════════════════════════════════════════════════════════════
-- Prospector — initial schema
--
-- Modelling decisions worth knowing before you change anything here:
--
-- 1. OWNER FIELDS ARE DENORMALISED ONTO `properties` ON PURPOSE.
--    A separate `owners` table looks tempting because owners repeat across
--    units, but `ownerKeyOf()` groups owners *dynamically* by phone-else-name,
--    and an import overwrites the owner of a unit wholesale. Promoting owners
--    to their own table would change dedupe and assignment semantics (assign()
--    expands a batch to every pool unit sharing owner+community). Denormalised
--    mirrors the reference implementation exactly. `owner_key` is written by
--    the application using the shared ownerKeyOf() so SQL and TS can't drift.
--
-- 2. ID ARRAYS BECOME JUNCTION TABLES.
--    CallLog.propertyIds / BatchRequest.unitIds / AuditEntry.propertyIds were
--    JSON arrays. As junction tables they get real FKs and turn callsFor() from
--    a full scan into an indexed join.
--
-- 3. `extra` STAYS JSON.
--    Unmapped upload columns are schemaless by design — the app renders them as
--    dynamic columns. JSON is the honest representation.
--
-- 4. `unit_key` / `lead_key` ARE HASHED FOR THEIR UNIQUE INDEX.
--    The keys themselves can be long; BINARY(32) of SHA2-256 keeps the unique
--    index small and safely inside InnoDB's limit while the readable key stays
--    in its own column for debugging.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(64)  NOT NULL PRIMARY KEY,
  applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Users ──────────────────────────────────────────────────────────────────
-- Users are deactivated, never deleted (Security Playbook: history must stay
-- auditable). `permissions` NULL means "role defaults" — mirrors AppUser's
-- optional permission set.
CREATE TABLE IF NOT EXISTS users (
  id                   VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id               VARCHAR(64)  NOT NULL,
  name                 VARCHAR(255) NOT NULL,
  email                VARCHAR(255) NOT NULL,
  password_hash        VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  role                 ENUM('manager','broker') NOT NULL,
  active               TINYINT(1)   NOT NULL DEFAULT 1,
  team                 VARCHAR(255) NOT NULL DEFAULT '',
  permissions          JSON         NULL,
  view_cap_override    INT          NULL,
  created_at           DATETIME(3)  NOT NULL,
  updated_at           DATETIME(3)  NOT NULL,
  UNIQUE KEY uk_users_email (email),
  KEY ix_users_org_role (org_id, role, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Sessions ───────────────────────────────────────────────────────────────
-- We store only a SHA-256 of the session token: a database leak must not hand
-- an attacker live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   BINARY(32)   NOT NULL PRIMARY KEY,
  user_id      VARCHAR(64)  NOT NULL,
  csrf_token   CHAR(64)     NOT NULL,
  created_at   DATETIME(3)  NOT NULL,
  last_seen_at DATETIME(3)  NOT NULL,
  expires_at   DATETIME(3)  NOT NULL,
  user_agent   VARCHAR(255) NULL,
  ip           VARCHAR(64)  NULL,
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Settings (one row per org) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  org_id                     VARCHAR(64) NOT NULL PRIMARY KEY,
  not_interested_cooldown_days INT       NOT NULL DEFAULT 30,
  listed_cooldown_days       INT         NOT NULL DEFAULT 30,
  max_no_answer_attempts     INT         NOT NULL DEFAULT 3,
  assignment_expiry_days     INT         NOT NULL DEFAULT 14,
  portfolio_stale_days       INT         NOT NULL DEFAULT 21,
  daily_view_cap             INT         NOT NULL DEFAULT 100,
  wifi_lock_enabled          TINYINT(1)  NOT NULL DEFAULT 0,
  office_ip                  VARCHAR(64) NOT NULL DEFAULT '',
  updated_at                 DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Data sets ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasets (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id          VARCHAR(64)  NOT NULL,
  name            VARCHAR(255) NOT NULL,
  source          VARCHAR(255) NOT NULL DEFAULT '',
  type            ENUM('register','transactions') NOT NULL DEFAULT 'register',
  module          ENUM('owners','leads')          NOT NULL DEFAULT 'owners',
  file_name       VARCHAR(255) NOT NULL DEFAULT '',
  community_label VARCHAR(255) NOT NULL DEFAULT '',
  imported_at     DATETIME(3)  NOT NULL,
  imported_by     VARCHAR(64)  NULL,
  cost            DECIMAL(14,2) NULL,
  total_units     INT NOT NULL DEFAULT 0,
  callable_units  INT NOT NULL DEFAULT 0,
  updated_units   INT NOT NULL DEFAULT 0,
  KEY ix_datasets_org (org_id, imported_at),
  CONSTRAINT fk_datasets_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Properties (owner records) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id                     VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id                 VARCHAR(64)  NOT NULL,
  dataset_id             VARCHAR(64)  NULL,
  state                  ENUM('pool','assigned','portfolio','cooling','dnc') NOT NULL DEFAULT 'pool',

  unit_key               VARCHAR(512) NOT NULL,
  unit_key_hash          BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(unit_key, 256))) STORED,

  community              VARCHAR(255) NOT NULL DEFAULT '',
  cluster                VARCHAR(255) NULL,
  building               VARCHAR(255) NULL,
  unit_number            VARCHAR(128) NULL,
  plot_number            VARCHAR(128) NULL,
  property_type          VARCHAR(128) NULL,
  beds                   INT          NULL,
  size_sqft              DOUBLE       NULL,
  plot_sqft              DOUBLE       NULL,
  last_transaction_date  DATETIME(3)  NULL,
  last_transaction_value DOUBLE       NULL,
  tx_count               INT          NOT NULL DEFAULT 0,
  rent_start             DATETIME(3)  NULL,
  rent_end               DATETIME(3)  NULL,
  rent_amount            DOUBLE       NULL,

  owner_name             VARCHAR(255) NOT NULL DEFAULT '',
  owner_phone            VARCHAR(64)  NULL,
  owner_nationality      VARCHAR(128) NULL,
  -- Written by the app via the shared ownerKeyOf(); see note 1 at the top.
  owner_key              VARCHAR(320) NOT NULL,
  -- Mirrors Property.callable — indexed so "Callable" filters and counts are cheap.
  callable               TINYINT(1) GENERATED ALWAYS AS
                           (owner_phone IS NOT NULL AND owner_phone <> '') STORED,

  extra                  JSON         NULL,

  created_at             DATETIME(3)  NOT NULL,
  updated_at             DATETIME(3)  NOT NULL,

  assigned_to            VARCHAR(64)  NULL,
  assigned_at            DATETIME(3)  NULL,
  assignment_note        TEXT         NULL,
  cooldown_until         DATETIME(3)  NULL,
  portfolio_since        DATETIME(3)  NULL,
  last_outcome           ENUM('noAnswer','unreachable','callbackLater','interestedSell',
                              'interestedRent','notInterested','alreadyListed','dnc') NULL,
  last_called_at         DATETIME(3)  NULL,
  call_attempts          INT          NOT NULL DEFAULT 0,
  next_follow_up_at      DATETIME(3)  NULL,
  dnc_at                 DATETIME(3)  NULL,

  UNIQUE KEY uk_properties_unit (org_id, unit_key_hash),
  KEY ix_prop_state        (org_id, state),
  KEY ix_prop_assigned     (assigned_to, state),
  KEY ix_prop_community    (org_id, community, cluster),
  KEY ix_prop_dataset      (dataset_id),
  KEY ix_prop_owner_key    (owner_key),
  KEY ix_prop_followup     (org_id, next_follow_up_at),
  KEY ix_prop_cooldown     (org_id, state, cooldown_until),
  KEY ix_prop_tx_date      (org_id, last_transaction_date),
  KEY ix_prop_beds         (org_id, beds),
  KEY ix_prop_nationality  (org_id, owner_nationality),
  KEY ix_prop_outcome      (org_id, last_outcome),
  KEY ix_prop_callable     (org_id, callable),
  KEY ix_prop_pool_pick    (org_id, state, community, cluster, callable),
  CONSTRAINT fk_prop_dataset  FOREIGN KEY (dataset_id)  REFERENCES datasets(id) ON DELETE SET NULL,
  CONSTRAINT fk_prop_assignee FOREIGN KEY (assigned_to) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Leads (buyer enquiries) ────────────────────────────────────────────────
-- Shares PropertyState + the disposition machine with properties by design.
CREATE TABLE IF NOT EXISTS leads (
  id                VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id            VARCHAR(64)  NOT NULL,
  dataset_id        VARCHAR(64)  NULL,
  state             ENUM('pool','assigned','portfolio','cooling','dnc') NOT NULL DEFAULT 'pool',

  lead_key          VARCHAR(320) NOT NULL,
  lead_key_hash     BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(lead_key, 256))) STORED,

  enquiry_date      DATETIME(3)  NULL,
  name              VARCHAR(255) NOT NULL DEFAULT '',
  phone             VARCHAR(64)  NULL,
  email             VARCHAR(255) NULL,
  project           VARCHAR(255) NULL,
  source            VARCHAR(255) NULL,
  callable          TINYINT(1) GENERATED ALWAYS AS (phone IS NOT NULL AND phone <> '') STORED,
  extra             JSON         NULL,

  created_at        DATETIME(3)  NOT NULL,
  updated_at        DATETIME(3)  NOT NULL,

  assigned_to       VARCHAR(64)  NULL,
  assigned_at       DATETIME(3)  NULL,
  assignment_note   TEXT         NULL,
  cooldown_until    DATETIME(3)  NULL,
  portfolio_since   DATETIME(3)  NULL,
  last_outcome      ENUM('noAnswer','unreachable','callbackLater','interestedSell',
                         'interestedRent','notInterested','alreadyListed','dnc') NULL,
  last_called_at    DATETIME(3)  NULL,
  call_attempts     INT          NOT NULL DEFAULT 0,
  next_follow_up_at DATETIME(3)  NULL,
  dnc_at            DATETIME(3)  NULL,

  UNIQUE KEY uk_leads_key (org_id, lead_key_hash),
  KEY ix_lead_state     (org_id, state),
  KEY ix_lead_assigned  (assigned_to, state),
  KEY ix_lead_dataset   (dataset_id),
  KEY ix_lead_project   (org_id, project),
  KEY ix_lead_source    (org_id, source),
  KEY ix_lead_enquiry   (org_id, enquiry_date),
  KEY ix_lead_callable  (org_id, callable),
  KEY ix_lead_outcome   (org_id, last_outcome),
  CONSTRAINT fk_lead_dataset  FOREIGN KEY (dataset_id)  REFERENCES datasets(id) ON DELETE SET NULL,
  CONSTRAINT fk_lead_assignee FOREIGN KEY (assigned_to) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Calls ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls (
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  org_id      VARCHAR(64) NOT NULL,
  broker_id   VARCHAR(64) NOT NULL,
  at          DATETIME(3) NOT NULL,
  outcome     ENUM('noAnswer','unreachable','callbackLater','interestedSell',
                   'interestedRent','notInterested','alreadyListed','dnc') NOT NULL,
  note        TEXT        NULL,
  follow_up_at DATETIME(3) NULL,
  KEY ix_calls_broker (broker_id, at),
  KEY ix_calls_at     (org_id, at),
  KEY ix_calls_outcome (org_id, outcome, at),
  CONSTRAINT fk_calls_broker FOREIGN KEY (broker_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS call_properties (
  call_id     VARCHAR(64) NOT NULL,
  property_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (call_id, property_id),
  KEY ix_cp_property (property_id),
  CONSTRAINT fk_cp_call     FOREIGN KEY (call_id)     REFERENCES calls(id)      ON DELETE CASCADE,
  CONSTRAINT fk_cp_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS call_leads (
  call_id VARCHAR(64) NOT NULL,
  lead_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (call_id, lead_id),
  KEY ix_cl_lead (lead_id),
  CONSTRAINT fk_cl_call FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
  CONSTRAINT fk_cl_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Batch requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS requests (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id        VARCHAR(64)  NOT NULL,
  broker_id     VARCHAR(64)  NOT NULL,
  community     VARCHAR(255) NOT NULL DEFAULT '',
  cluster       VARCHAR(255) NULL,
  count         INT          NOT NULL DEFAULT 0,
  note          TEXT         NULL,
  at            DATETIME(3)  NOT NULL,
  status        ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  decided_at    DATETIME(3)  NULL,
  decided_by    VARCHAR(64)  NULL,
  granted_count INT          NOT NULL DEFAULT 0,
  KEY ix_req_status (org_id, status, at),
  KEY ix_req_broker (broker_id, at),
  CONSTRAINT fk_req_broker  FOREIGN KEY (broker_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS request_units (
  request_id  VARCHAR(64) NOT NULL,
  property_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (request_id, property_id),
  KEY ix_ru_property (property_id),
  CONSTRAINT fk_ru_request  FOREIGN KEY (request_id)  REFERENCES requests(id)   ON DELETE CASCADE,
  CONSTRAINT fk_ru_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Audit ──────────────────────────────────────────────────────────────────
-- Append-only. `ix_audit_view_cap` is what makes the per-broker daily view cap
-- a cheap COUNT instead of scanning the whole trail.
CREATE TABLE IF NOT EXISTS audit (
  id       VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id   VARCHAR(64)  NOT NULL,
  at       DATETIME(3)  NOT NULL,
  actor_id VARCHAR(64)  NULL,
  action   VARCHAR(64)  NOT NULL,
  detail   TEXT         NOT NULL,
  KEY ix_audit_at       (org_id, at),
  KEY ix_audit_view_cap (actor_id, action, at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_properties (
  audit_id    VARCHAR(64) NOT NULL,
  property_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (audit_id, property_id),
  KEY ix_ap_property (property_id),
  CONSTRAINT fk_ap_audit FOREIGN KEY (audit_id) REFERENCES audit(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Import staging ─────────────────────────────────────────────────────────
-- The uploaded file is parsed then DISCARDED — bytes are never written to disk.
-- Only the parsed rows live here, and only until the import is committed or the
-- session expires (reaped by a sweeper).
CREATE TABLE IF NOT EXISTS import_sessions (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id      VARCHAR(64)  NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  module      ENUM('owners','leads') NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  sheet_names JSON         NOT NULL,
  row_counts  JSON         NOT NULL,
  status      ENUM('staged','committed') NOT NULL DEFAULT 'staged',
  created_at  DATETIME(3)  NOT NULL,
  expires_at  DATETIME(3)  NOT NULL,
  KEY ix_import_user (user_id),
  KEY ix_import_expiry (expires_at),
  CONSTRAINT fk_import_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_rows (
  session_id  VARCHAR(64) NOT NULL,
  sheet_index INT         NOT NULL,
  row_index   INT         NOT NULL,
  cells       JSON        NOT NULL,
  PRIMARY KEY (session_id, sheet_index, row_index),
  CONSTRAINT fk_import_rows_session FOREIGN KEY (session_id)
    REFERENCES import_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
