import * as XLSX from 'xlsx';
import { ParsedFile, ParsedSheet } from './importModels';

export function parseVendorFile(fileName: string, data: ArrayBuffer): ParsedFile {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    const rows = parseCSV(text);
    return new ParsedFile(fileName, [new ParsedSheet('CSV', rows)]);
  }

  const workbook = XLSX.read(data, { type: 'array', cellDates: true, raw: true });
  const sheets: ParsedSheet[] = [];
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
    if (jsonRows.length === 0) continue;
    const normalised: unknown[][] = jsonRows.map(row => {
      if (!Array.isArray(row)) return [row];
      return row.map(cell => normalizeCell(cell));
    });
    sheets.push(new ParsedSheet(name, normalised));
  }
  return new ParsedFile(fileName, sheets);
}

function normalizeCell(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v;
    const rounded = Math.round(v);
    if (v === rounded) return rounded;
    return v;
  }
  if (v instanceof Date) return v;
  return String(v).trim();
}

interface CSVRow {
  [key: string]: string;
}

function parseCSV(text: string): unknown[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rows: unknown[][] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const cells = parseCSVLine(line);
    rows.push(cells.map(c => {
      const t = c.trim();
      return t.length === 0 ? null : t;
    }));
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// `saveFile` moved to ./downloadFile — it needs the DOM, and this module is
// compiled by the server too (see server/tsconfig.json). Import it from there.
