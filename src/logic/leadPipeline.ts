import { Lead, kOrgId } from '../types/models';
import { ParsedSheet } from './importModels';
import { ImportPipeline } from './importPipeline';

export enum LeadField {
  enquiryDate = 'enquiryDate',
  name = 'name',
  phone = 'phone',
  email = 'email',
  project = 'project',
  source = 'source',
  extra = 'extra',
  ignore = 'ignore',
}

export const LeadFieldLabel: Record<LeadField, string> = {
  [LeadField.enquiryDate]: 'Enquiry date',
  [LeadField.name]: 'Lead name',
  [LeadField.phone]: 'Phone',
  [LeadField.email]: 'Email',
  [LeadField.project]: 'Project / development',
  [LeadField.source]: 'Source / campaign',
  [LeadField.extra]: 'Keep as extra column',
  [LeadField.ignore]: '— ignore —',
};

export class LeadColumnSpec {
  constructor(
    public index: number,
    public header: string,
    public field: LeadField,
    public filled: number,
    public sampled: number,
    public samples: string[],
  ) {}
}

export class LeadDryRun {
  constructor(
    public sourceRows: number,
    public invalidRows: number,
    public inFileDuplicates: number,
    public newLeads: Lead[],
    public updatedLeads: Lead[],
  ) {}

  get uniqueLeads(): number { return this.newLeads.length + this.updatedLeads.length; }
  get callable(): number {
    return this.newLeads.filter(l => l.callable).length +
      this.updatedLeads.filter(l => l.callable).length;
  }
}

export abstract class LeadPipeline {
  static autoMapHeader(header: string): LeadField {
    const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (h.length === 0) return LeadField.ignore;
    const has = (s: string) => h.includes(s);

    if (has('date') || has('enquir') || has('inquir') || has('created') ||
        has('received') || has('timestamp')) return LeadField.enquiryDate;
    if (has('phone') || has('mobile') || has('whatsapp') || has('contactno') ||
        h === 'tel' || h === 'number') return LeadField.phone;
    if (has('email') || h === 'mail') return LeadField.email;
    if (has('source') || has('campaign') || has('portal') || has('channel') ||
        has('medium') || has('utm') || has('platform')) return LeadField.source;
    if (has('project') || has('development') || has('community') ||
        has('building') || has('listing')) return LeadField.project;
    if (has('name')) return LeadField.name;
    return LeadField.extra;
  }

  static buildColumns(rows: unknown[][], headerRow: number): LeadColumnSpec[] {
    const header = rows[headerRow];
    const data = rows.slice(headerRow + 1, headerRow + 1 + 300);
    const specs: LeadColumnSpec[] = [];
    for (let c = 0; c < header.length; c++) {
      const name = (header[c]?.toString().trim()) || `Column ${c + 1}`;
      const values = data.map(r => (c < r.length) ? r[c] : null);
      const filled = values.filter(v => v != null && String(v).trim().length > 0).length;
      specs.push(new LeadColumnSpec(
        c, name, this.autoMapHeader(name), filled, values.length,
        values.filter(v => v != null && String(v).trim().length > 0).slice(0, 3).map(v => String(v)),
      ));
    }
    const seen = new Set<LeadField>();
    for (const s of specs) {
      if (s.field === LeadField.extra || s.field === LeadField.ignore) continue;
      if (seen.has(s.field)) s.field = LeadField.extra;
      seen.add(s.field);
    }
    return specs;
  }

  static display(v: unknown): string {
    if (v instanceof Date) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    if (typeof v === 'number' && Number.isInteger(v)) return String(v);
    if (typeof v === 'number') return String(v);
    return String(v).trim();
  }

  static dryRun(params: {
    sheet: ParsedSheet; headerRow: number; columns: LeadColumnSpec[];
    datasetId: string; existingByKey: Map<string, Lead>;
  }): LeadDryRun {
    const now = new Date().toISOString();
    const dataRows = params.sheet.rows.slice(params.headerRow + 1);
    const cell = (row: unknown[], f: LeadField) => {
      for (const c of params.columns) {
        if (c.field === f && c.index < row.length) return row[c.index];
      }
      return null;
    };
    const byKey = new Map<string, Lead>();
    let invalid = 0, dupes = 0, seq = 0;

    for (const row of dataRows) {
      if (row.every(c => c == null || String(c).trim().length === 0)) continue;
      const name = str(cell(row, LeadField.name)) ?? '';
      const phone = ImportPipeline.normalizePhone(cell(row, LeadField.phone));
      const email = str(cell(row, LeadField.email));
      if (name.length === 0 && phone == null && email == null) { invalid++; continue; }

      const extra: Record<string, string> = {};
      for (const c of params.columns) {
        if (c.field !== LeadField.extra || c.index >= row.length) continue;
        const v = row[c.index];
        if (v == null || String(v).trim().length === 0) continue;
        extra[c.header] = this.display(v);
      }

      const lead = new Lead(
        `l-${Date.now()}-${seq++}`, kOrgId, params.datasetId,
        ImportPipeline.dateOf(cell(row, LeadField.enquiryDate)),
        name, phone, email, str(cell(row, LeadField.project)),
        str(cell(row, LeadField.source)), extra, now,
      );
      if (byKey.has(lead.leadKey)) dupes++;
      byKey.set(lead.leadKey, lead);
    }

    const newLeads: Lead[] = [];
    const updatedLeads: Lead[] = [];
    for (const lead of Array.from(byKey.values())) {
      const existing = params.existingByKey.get(lead.leadKey);
      if (existing == null) {
        newLeads.push(lead);
      } else {
        const refreshed = Lead.fromJson(existing.toJson() as Record<string, unknown>);
        refreshed.refreshFrom(lead, now);
        updatedLeads.push(refreshed);
      }
    }

    return new LeadDryRun(dataRows.length, invalid, dupes, newLeads, updatedLeads);
  }
}

function str(v: unknown): string | undefined {
  const s = v?.toString().trim();
  return (s == null || s.length === 0) ? undefined : s;
}
