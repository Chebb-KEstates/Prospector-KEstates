import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { DataModule, DataSetType, kOrgId } from '../../../src/types/models';
import { ColumnSpec } from '../../../src/logic/importModels';
import { deserializeCells } from './importRepo';

/**
 * The retained source of an owners import — the parsed grid plus the mapping it
 * was imported with — kept so a data set can be re-downloaded and re-mapped
 * without re-uploading. Written at commit from the staging scratchpad (the cells
 * are copied verbatim, so they round-trip exactly), and replaced on each update.
 */

export interface DatasetSourceMeta {
  datasetId: string;
  fileName: string;
  module: DataModule;
  sheetName: string;
  headerRow: number;
  columns: ColumnSpec[];
  type: DataSetType;
  community: string;
  rowCount: number;
}

function jsonParse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

/**
 * Retain (or replace) a data set's source, copying the staged rows straight from
 * `import_rows` — same serialized shape, so nothing is lost in translation. Runs
 * inside the commit transaction, before the scratchpad is dropped.
 */
export async function retainSource(input: {
  datasetId: string;
  fileName: string;
  module: DataModule;
  sheetName: string;
  headerRow: number;
  columns: ColumnSpec[];
  type: DataSetType;
  community: string;
  rowCount: number;
  sessionId: string;
  sheetIndex: number;
}, cx: PoolConnection): Promise<void> {
  const now = toDb(new Date().toISOString());
  await cx.query(
    `INSERT INTO dataset_source
       (dataset_id, org_id, file_name, module, sheet_name, header_row, columns,
        type, community, row_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       file_name = VALUES(file_name), module = VALUES(module),
       sheet_name = VALUES(sheet_name), header_row = VALUES(header_row),
       columns = VALUES(columns), type = VALUES(type),
       community = VALUES(community), row_count = VALUES(row_count),
       updated_at = VALUES(updated_at)`,
    [
      input.datasetId, kOrgId, input.fileName, input.module, input.sheetName,
      input.headerRow, JSON.stringify(input.columns), input.type, input.community,
      input.rowCount, now, now,
    ],
  );

  await cx.query('DELETE FROM dataset_source_rows WHERE dataset_id = ?', [input.datasetId]);
  await cx.query(
    `INSERT INTO dataset_source_rows (dataset_id, row_index, cells)
       SELECT ?, row_index, cells FROM import_rows
        WHERE session_id = ? AND sheet_index = ?`,
    [input.datasetId, input.sessionId, input.sheetIndex],
  );
}

export async function getDatasetSource(datasetId: string): Promise<DatasetSourceMeta | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT dataset_id, file_name, module, sheet_name, header_row, columns,
            type, community, row_count
       FROM dataset_source WHERE dataset_id = ? LIMIT 1`,
    [datasetId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    datasetId: r.dataset_id as string,
    fileName: r.file_name as string,
    module: r.module as DataModule,
    sheetName: r.sheet_name as string,
    headerRow: Number(r.header_row ?? 0),
    columns: jsonParse<ColumnSpec[]>(r.columns, []),
    type: r.type as DataSetType,
    community: (r.community as string) ?? '',
    rowCount: Number(r.row_count ?? 0),
  };
}

/** Which data set ids have a retained source — for the list's availability flags. */
export async function datasetsWithSource(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [rows] = await pool.query<Row[]>(
    `SELECT dataset_id FROM dataset_source WHERE dataset_id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  return new Set(rows.map(r => r.dataset_id as string));
}

/** The parsed grid, dates rebuilt — for regenerating the original as .xlsx. */
export async function loadSourceGrid(datasetId: string): Promise<unknown[][]> {
  const [rows] = await pool.query<Row[]>(
    'SELECT cells FROM dataset_source_rows WHERE dataset_id = ? ORDER BY row_index',
    [datasetId],
  );
  return rows.map(r => {
    const cells = typeof r.cells === 'string' ? JSON.parse(r.cells) : r.cells;
    return deserializeCells(Array.isArray(cells) ? cells : []);
  });
}

/**
 * Copy a data set's retained rows into a fresh staging session — the basis of an
 * in-app re-map: the wizard then treats it exactly like a just-uploaded file,
 * only nobody had to upload anything.
 */
export async function restageFromSource(input: {
  datasetId: string;
  newSessionId: string;
  userId: string;
  source: DatasetSourceMeta;
  expiresAt: Date;
}, cx: PoolConnection): Promise<void> {
  await cx.query(
    `INSERT INTO import_sessions
       (id, org_id, user_id, module, file_name, sheet_names, row_counts,
        status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?)`,
    [
      input.newSessionId, kOrgId, input.userId, input.source.module, input.source.fileName,
      JSON.stringify([input.source.sheetName]),
      JSON.stringify([input.source.rowCount]),
      new Date(), input.expiresAt,
    ],
  );
  await cx.query(
    `INSERT INTO import_rows (session_id, sheet_index, row_index, cells)
       SELECT ?, 0, row_index, cells FROM dataset_source_rows WHERE dataset_id = ?`,
    [input.newSessionId, input.datasetId],
  );
}
