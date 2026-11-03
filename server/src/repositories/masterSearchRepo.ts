import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { kOrgId } from '../../../src/types/models';
import { ParsedSearchRow, searchTextOf } from '../services/masterSearchService';

/**
 * Master Search storage: uploaded files (with their original bytes) and the rows
 * read from them. A row carries its source file's id and name; deleting the file
 * deletes its rows (FK cascade).
 */

export interface SearchFileMeta {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sheetCount: number;
  rowCount: number;
  uploadedBy?: string;
  uploadedAt: string;
}

export interface SearchHit {
  file: string;
  sheet: string;
  row: number;
  cells: [string, string][];
}

const META_COLS = 'id, file_name, content_type, size_bytes, sheet_count, row_count, uploaded_by, uploaded_at';

function toMeta(r: Row): SearchFileMeta {
  return {
    id: r.id as string,
    fileName: r.file_name as string,
    contentType: r.content_type as string,
    sizeBytes: Number(r.size_bytes),
    sheetCount: Number(r.sheet_count),
    rowCount: Number(r.row_count),
    uploadedBy: (r.uploaded_by as string) ?? undefined,
    uploadedAt: fromDb(r.uploaded_at)!,
  };
}

function parseCells(v: unknown): [string, string][] {
  const j = typeof v === 'string' ? JSON.parse(v) : v;
  return Array.isArray(j) ? (j as [string, string][]) : [];
}

export async function listSearchFiles(): Promise<SearchFileMeta[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${META_COLS} FROM search_files WHERE org_id = ? ORDER BY uploaded_at DESC, file_name`, [kOrgId]);
  return rows.map(toMeta);
}

export async function findSearchFile(id: string): Promise<SearchFileMeta | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${META_COLS} FROM search_files WHERE org_id = ? AND id = ?`, [kOrgId, id]);
  return rows.length ? toMeta(rows[0]) : null;
}

export async function findSearchFileByName(fileName: string, cx?: PoolConnection): Promise<SearchFileMeta | null> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    `SELECT ${META_COLS} FROM search_files WHERE org_id = ? AND file_name = ?`, [kOrgId, fileName]);
  return rows.length ? toMeta(rows[0]) : null;
}

/** The original bytes, exactly as uploaded. */
export async function readSearchFileContent(id: string): Promise<{ meta: SearchFileMeta; content: Buffer } | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${META_COLS}, content FROM search_files WHERE org_id = ? AND id = ?`, [kOrgId, id]);
  if (!rows.length) return null;
  return { meta: toMeta(rows[0]), content: rows[0].content as Buffer };
}

const ROW_CHUNK = 500;

/** Store a file and its rows (inside the caller's transaction). */
export async function insertSearchFile(input: {
  id: string; fileName: string; contentType: string; content: Buffer;
  sheetCount: number; rows: ParsedSearchRow[]; uploadedBy: string;
}, cx: PoolConnection): Promise<void> {
  await cx.query(
    `INSERT INTO search_files
       (id, org_id, file_name, content_type, size_bytes, content, sheet_count, row_count, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, kOrgId, input.fileName, input.contentType, input.content.length, input.content,
      input.sheetCount, input.rows.length, input.uploadedBy, toDb(new Date().toISOString())],
  );
  for (let i = 0; i < input.rows.length; i += ROW_CHUNK) {
    const chunk = input.rows.slice(i, i + ROW_CHUNK);
    await cx.query(
      `INSERT INTO search_rows (org_id, file_id, file_name, sheet_name, row_no, cells, search_text)
       VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      chunk.flatMap(r => [
        kOrgId, input.id, input.fileName, r.sheet, r.rowNo, JSON.stringify(r.cells), searchTextOf(r.cells),
      ]),
    );
  }
}

/** Delete a file and (by cascade) every row read from it. Returns the rows removed. */
export async function deleteSearchFile(id: string, cx: PoolConnection): Promise<number> {
  const [cnt] = await cx.query<Row[]>(
    'SELECT COUNT(*) AS n FROM search_rows WHERE org_id = ? AND file_id = ?', [kOrgId, id]);
  await cx.query('DELETE FROM search_files WHERE org_id = ? AND id = ?', [kOrgId, id]);
  return Number(cnt[0].n);
}

/** Escape LIKE wildcards so a typed % or _ is matched literally. */
function likeTerm(t: string): string {
  return `%${t.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/**
 * Rows whose values contain EVERY term (case-insensitive, any column, in any
 * order). Returns the total and the first `limit` rows, in file / sheet / row
 * order.
 */
export async function searchRows(terms: string[], limit: number): Promise<{ total: number; hits: SearchHit[] }> {
  if (terms.length === 0) return { total: 0, hits: [] };
  const where = ['org_id = ?', ...terms.map(() => "search_text LIKE ? ESCAPE '\\\\'")];
  const params: unknown[] = [kOrgId, ...terms.map(likeTerm)];
  const [count] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM search_rows WHERE ${where.join(' AND ')}`, params);
  const [rows] = await pool.query<Row[]>(
    `SELECT file_name, sheet_name, row_no, cells FROM search_rows
      WHERE ${where.join(' AND ')}
      ORDER BY file_name, sheet_name, row_no
      LIMIT ?`,
    [...params, limit],
  );
  return {
    total: Number(count[0].n),
    hits: rows.map(r => ({
      file: r.file_name as string, sheet: r.sheet_name as string,
      row: Number(r.row_no), cells: parseCells(r.cells),
    })),
  };
}

/** How much is searchable: files and rows. */
export async function searchStats(): Promise<{ files: number; rows: number }> {
  const [rows] = await pool.query<Row[]>(
    `SELECT (SELECT COUNT(*) FROM search_files WHERE org_id = ?) AS files,
            (SELECT COALESCE(SUM(row_count), 0) FROM search_files WHERE org_id = ?) AS rows_`,
    [kOrgId, kOrgId]);
  return { files: Number(rows[0].files), rows: Number(rows[0].rows_) };
}
