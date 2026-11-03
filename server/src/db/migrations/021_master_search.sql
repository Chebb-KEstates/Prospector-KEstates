-- Master Search — search every row of every uploaded spreadsheet.
--
-- `search_files` keeps each ORIGINAL file, byte for byte, so an admin can
-- download exactly what was uploaded. Like the retained import sources (009),
-- the bytes live in the database, never on disk.
--
-- `search_rows` is one row per spreadsheet row: its source file (id AND name, so
-- a whole batch can be found and removed by file), sheet, Excel row number, its
-- cells in column order, and a lowercased search text. Deleting a file removes
-- its rows with it (ON DELETE CASCADE).
--
-- Additive: two new tables; nothing else changes.
CREATE TABLE IF NOT EXISTS search_files (
  id           VARCHAR(64)  NOT NULL PRIMARY KEY,
  org_id       VARCHAR(64)  NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  content_type VARCHAR(128) NOT NULL,
  size_bytes   INT          NOT NULL,
  content      LONGBLOB     NOT NULL,
  sheet_count  INT          NOT NULL DEFAULT 0,
  row_count    INT          NOT NULL DEFAULT 0,
  uploaded_by  VARCHAR(64)  NULL,
  uploaded_at  DATETIME(3)  NOT NULL,
  UNIQUE KEY ux_search_files_name (org_id, file_name),
  KEY ix_search_files_at (org_id, uploaded_at),
  CONSTRAINT fk_search_files_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS search_rows (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  org_id      VARCHAR(64)  NOT NULL,
  file_id     VARCHAR(64)  NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  sheet_name  VARCHAR(255) NOT NULL,
  row_no      INT          NOT NULL,
  cells       JSON         NOT NULL,
  search_text MEDIUMTEXT   NOT NULL,
  KEY ix_search_rows_file (file_id, sheet_name, row_no),
  KEY ix_search_rows_org (org_id, file_name),
  CONSTRAINT fk_search_rows_file FOREIGN KEY (file_id) REFERENCES search_files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
