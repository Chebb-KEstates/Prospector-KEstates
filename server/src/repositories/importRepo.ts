import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, fromDb } from '../db/pool';
import { DataModule, kOrgId } from '../../../src/types/models';
import { ParsedSheet } from '../../../src/logic/importModels';

/**
 * Import staging.
 *
 * The uploaded file is parsed in memory and DISCARDED — its bytes are never
 * written to disk (per the brief: no need to keep files after insert). What
 * survives is the parsed grid, here, until the wizard commits or the session
 * expires.
 *
 * Staging exists because the wizard is interactive: the user re-picks the header
 * row and re-maps columns and re-previews, repeatedly. Without staging, each of
 * those would mean re-uploading the file. With it, the server holds the rows and
 * the client sends only a mapping — which is also what lets the dry-run be
 * computed server-side, so the numbers the user approves are the server's, not
 * the client's.
 */

export interface StagedSession {
  id: string;
  userId: string;
  module: DataModule;
  fileName: string;
  sheetNames: string[];
  rowCounts: number[];
  status: 'staged' | 'committed';
  expiresAt: string;
}

const ROW_CHUNK = 500;

export async function createStagingSession(input: {
  id: string;
  userId: string;
  module: DataModule;
  fileName: string;
  sheets: ParsedSheet[];
  expiresAt: Date;
}, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;

  await db.query(
    `INSERT INTO import_sessions
       (id, org_id, user_id, module, file_name, sheet_names, row_counts,
        status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?)`,
    [
      input.id, kOrgId, input.userId, input.module, input.fileName,
      JSON.stringify(input.sheets.map(s => s.name)),
      JSON.stringify(input.sheets.map(s => s.rows.length)),
      new Date(), input.expiresAt,
    ],
  );

  for (let sheetIndex = 0; sheetIndex < input.sheets.length; sheetIndex++) {
    const rows = input.sheets[sheetIndex].rows;
    for (let i = 0; i < rows.length; i += ROW_CHUNK) {
      const chunk = rows.slice(i, i + ROW_CHUNK);
      await db.query(
        `INSERT INTO import_rows (session_id, sheet_index, row_index, cells)
         VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap((cells, j) => [
          input.id, sheetIndex, i + j, JSON.stringify(serializeCells(cells)),
        ]),
      );
    }
  }
}

/**
 * Dates need care through JSON.
 *
 * The parser yields real `Date` objects for date cells (cellDates: true), and
 * `ImportPipeline.dateOf` branches on `v instanceof Date`. A naive
 * JSON round-trip turns those into strings and silently changes which branch
 * runs, so dates are tagged on the way in and rebuilt on the way out.
 */
function serializeCells(cells: unknown[]): unknown[] {
  return cells.map(c => {
    if (c instanceof Date) return { __date: c.toISOString() };
    return c ?? null;
  });
}

function deserializeCells(cells: unknown[]): unknown[] {
  return cells.map(c => {
    if (c != null && typeof c === 'object' && '__date' in (c as object)) {
      const d = new Date((c as { __date: string }).__date);
      return isNaN(d.getTime()) ? null : d;
    }
    return c;
  });
}

export async function findStagingSession(
  id: string, cx?: PoolConnection,
): Promise<StagedSession | null> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    `SELECT id, user_id, module, file_name, sheet_names, row_counts, status, expires_at
     FROM import_sessions WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id as string,
    userId: r.user_id as string,
    module: r.module as DataModule,
    fileName: r.file_name as string,
    sheetNames: asArray(r.sheet_names).map(String),
    rowCounts: asArray(r.row_counts).map(Number),
    status: r.status as 'staged' | 'committed',
    expiresAt: fromDb(r.expires_at)!,
  };
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  }
  return [];
}

/** Read a sheet's rows back as the grid the pipeline expects. */
export async function loadStagedSheet(
  sessionId: string, sheetIndex: number, cx?: PoolConnection,
): Promise<unknown[][]> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    `SELECT cells FROM import_rows
     WHERE session_id = ? AND sheet_index = ?
     ORDER BY row_index`,
    [sessionId, sheetIndex],
  );
  return rows.map(r => {
    const cells = typeof r.cells === 'string' ? JSON.parse(r.cells) : r.cells;
    return deserializeCells(Array.isArray(cells) ? cells : []);
  });
}

/** Just the first N rows of a sheet — for the header-row picker preview. */
export async function loadStagedPreview(
  sessionId: string, sheetIndex: number, limit: number,
): Promise<unknown[][]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT cells FROM import_rows
     WHERE session_id = ? AND sheet_index = ?
     ORDER BY row_index LIMIT ?`,
    [sessionId, sheetIndex, limit],
  );
  return rows.map(r => {
    const cells = typeof r.cells === 'string' ? JSON.parse(r.cells) : r.cells;
    return deserializeCells(Array.isArray(cells) ? cells : []);
  });
}

export async function markCommitted(id: string, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query(`UPDATE import_sessions SET status = 'committed' WHERE id = ?`, [id]);
}

/** Staged rows are dropped the moment they're committed — they're a scratchpad. */
export async function dropStagedRows(id: string, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query('DELETE FROM import_rows WHERE session_id = ?', [id]);
}

export async function deleteStagingSession(id: string, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  // import_rows cascades.
  await db.query('DELETE FROM import_sessions WHERE id = ?', [id]);
}

/**
 * Housekeeping — abandoned wizards must not keep owner data lying around.
 *
 * UTC_TIMESTAMP — expires_at is bound as a JS Date and so holds UTC; NOW() threw
 * away live staging sessions a UTC offset early, mid-wizard.
 */
export async function sweepExpiredImports(): Promise<number> {
  const [res] = await pool.query('DELETE FROM import_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}
