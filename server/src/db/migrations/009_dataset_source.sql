-- ═══════════════════════════════════════════════════════════════════════════
-- 009 — retain an owners import's parsed source with the data set
--
-- Until now the parsed rows were a scratchpad, dropped the moment an import
-- committed. Keeping them attached to the data set lets a manager (a) download
-- the file again and (b) re-map its columns without re-uploading. Populated at
-- commit and REPLACED on each update, so it mirrors the latest file. Owner data
-- gets the same protection as the rest — it lives in the database, not on disk.
--
-- Only applies to imports from here on; sets imported before this have no source
-- (their files were already discarded).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dataset_source (
  dataset_id   VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id       VARCHAR(64)  NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  module       VARCHAR(16)  NOT NULL,
  sheet_name   VARCHAR(255) NOT NULL,
  header_row   INT          NOT NULL DEFAULT 0,
  columns      JSON         NOT NULL,
  type         VARCHAR(32)  NOT NULL,
  community    VARCHAR(255) NOT NULL,
  row_count    INT          NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL,
  updated_at   DATETIME(3)  NOT NULL,
  CONSTRAINT fk_dataset_source_ds FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dataset_source_rows (
  dataset_id  VARCHAR(64) NOT NULL,
  row_index   INT         NOT NULL,
  cells       JSON        NOT NULL,
  PRIMARY KEY (dataset_id, row_index),
  CONSTRAINT fk_dataset_source_rows_ds FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
