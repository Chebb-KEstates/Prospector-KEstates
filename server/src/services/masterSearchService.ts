import * as XLSX from 'xlsx';
import { badRequest, unprocessable } from '../http/errors';

/**
 * Master Search — reading an uploaded spreadsheet into searchable rows.
 *
 * Every sheet of the workbook is read. The first non-empty row of a sheet is its
 * column names; every later row with at least one value becomes a search row,
 * kept as `[column, value]` pairs in column order with the value as Excel shows
 * it (formatted text, so dates and numbers read the way they do in the file).
 * Empty cells are left out. The Excel row number is kept so a result can point
 * back to the exact line in the original file.
 */

export const SEARCH_FILE_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.csv'];

export interface ParsedSearchRow {
  sheet: string;
  /** The row's number as Excel shows it (1-based, counting the header row). */
  rowNo: number;
  cells: [string, string][];
}

export interface ParsedSearchFile {
  sheetCount: number;
  rows: ParsedSearchRow[];
}

/** The lowercased text a row is matched against: its values, separated. */
export function searchTextOf(cells: [string, string][]): string {
  return cells.map(([, v]) => v).join(' \u0001 ').toLowerCase();
}

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i).toLowerCase() : '';
}

export function parseSearchFile(fileName: string, bytes: Buffer): ParsedSearchFile {
  const ext = extensionOf(fileName);
  if (!SEARCH_FILE_EXTENSIONS.includes(ext) || fileName.startsWith('~$')) {
    throw badRequest('Upload an Excel (.xlsx, .xls, .xlsm) or CSV file.');
  }

  let wb: XLSX.WorkBook;
  try {
    // CSV is decoded as UTF-8 text first; read as raw bytes, non-Latin text
    // (Arabic names, for one) would come out garbled.
    wb = ext === '.csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(bytes), { type: 'string', cellDates: true })
      : XLSX.read(bytes, { type: 'buffer', cellDates: true });
  } catch {
    throw unprocessable('That file could not be read. Is it a valid Excel or CSV file?');
  }

  const rows: ParsedSearchRow[] = [];
  let sheetCount = 0;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    sheetCount += 1;
    const range = XLSX.utils.decode_range(ws['!ref']);
    // blankrows keeps array index ↔ sheet row aligned, so row numbers are exact.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, blankrows: true });
    const text = (v: unknown) => (v == null ? '' : String(v)).trim();

    const headerIdx = grid.findIndex(r => Array.isArray(r) && r.some(c => text(c) !== ''));
    if (headerIdx < 0) continue;
    const headerRow = grid[headerIdx] as unknown[];
    const width = Math.max(headerRow.length, ...grid.map(r => (Array.isArray(r) ? r.length : 0)));
    // Unique, non-blank column names: a blank header becomes "Column C", a
    // repeated one "Name (2)" — so no value overwrites another.
    const seen = new Map<string, number>();
    const headers: string[] = [];
    for (let c = 0; c < width; c++) {
      let name = text(headerRow[c]) || `Column ${XLSX.utils.encode_col(range.s.c + c)}`;
      const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
      seen.set(name.toLowerCase(), n);
      if (n > 1) name = `${name} (${n})`;
      headers.push(name);
    }

    for (let i = headerIdx + 1; i < grid.length; i++) {
      const r = grid[i];
      if (!Array.isArray(r)) continue;
      const cells: [string, string][] = [];
      for (let c = 0; c < width; c++) {
        const v = text(r[c]);
        if (v !== '') cells.push([headers[c], v]);
      }
      if (cells.length > 0) rows.push({ sheet: sheetName, rowNo: range.s.r + i + 1, cells });
    }
  }

  if (rows.length === 0) {
    throw unprocessable('That file has no rows to search — the first row of each sheet should be the column names, with data below it.');
  }
  return { sheetCount, rows };
}
