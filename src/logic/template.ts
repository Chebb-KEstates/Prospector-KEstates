import * as XLSX from 'xlsx';
import { saveFile } from './downloadFile';

export const kTemplateHeaders = [
  'Community', 'Sub-Community', 'Building Name', 'Unit Number', 'Plot No',
  'Property Type', 'Beds', 'BUA (sqft)', 'Plot Size (sqft)', 'Transaction Date',
  'Transaction Value', 'Rent Start', 'Rent End', 'Rental Amount',
  'Owner Name', 'Mobile', 'Nationality',
];

export function buildTemplateXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([kTemplateHeaders]);
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(bytes);
}

export function downloadTemplate(): void {
  const bytes = buildTemplateXlsx();
  saveFile('prospector_template.xlsx', bytes);
}

export const kLeadTemplateHeaders = [
  'Enquiry Date', 'Name', 'Phone', 'Email', 'Project', 'Source', 'Notes',
];

export function buildLeadTemplateXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([kLeadTemplateHeaders]);
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(bytes);
}

export function downloadLeadTemplate(): void {
  const bytes = buildLeadTemplateXlsx();
  saveFile('prospector_leads_template.xlsx', bytes);
}
