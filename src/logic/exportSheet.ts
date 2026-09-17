import * as XLSX from 'xlsx';
import { saveFile } from './downloadFile';

/**
 * Save a 2-D array of cells as a one-sheet .xlsx download. Kept tiny and generic
 * so any table (the Report broker/area breakdowns, …) can hand over its already
 * flattened rows — the caller decides which columns and in what order, so the
 * sheet mirrors exactly what the manager configured on screen.
 */
export function downloadAoaXlsx(
  fileName: string,
  sheetName: string,
  aoa: (string | number | null | undefined)[][],
): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Excel caps a sheet name at 31 chars and forbids a few characters.
  const safe = sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
  XLSX.utils.book_append_sheet(wb, ws, safe);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveFile(fileName, new Uint8Array(bytes));
}
