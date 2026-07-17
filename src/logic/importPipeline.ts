import { Property, OwnerInfo, DataSetType, kOrgId, PropertyState } from '../types/models';
import { ImportField, ColumnSpec, ParsedSheet, DryRunResult } from './importModels';

export abstract class ImportPipeline {
  static detectHeaderRow(rows: unknown[][]): number {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const score = rows[i].filter(c => typeof c === 'string' && String(c).trim().length > 0).length;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  static buildColumns(rows: unknown[][], headerRow: number): ColumnSpec[] {
    const header = rows[headerRow];
    const data = rows.slice(headerRow + 1, headerRow + 1 + 300);
    const specs: ColumnSpec[] = [];
    for (let c = 0; c < header.length; c++) {
      const name = (header[c]?.toString().trim()) || `Column ${c + 1}`;
      const values = data.map(r => (c < r.length) ? r[c] : null);
      const filled = values.filter(v => v != null && String(v).trim().length > 0).length;
      specs.push(new ColumnSpec(
        c, name, this.autoMapHeader(name), filled, values.length,
        values.filter(v => v != null && String(v).trim().length > 0).slice(0, 3).map(v => String(v)),
      ));
    }
    const seen = new Set<ImportField>();
    for (const s of specs) {
      if (s.field === ImportField.ignore) continue;
      if (seen.has(s.field)) s.field = ImportField.ignore;
      seen.add(s.field);
    }
    return specs;
  }

  static autoMapHeader(header: string): ImportField {
    const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (h.length === 0) return ImportField.ignore;
    const has = (s: string) => h.includes(s);

    // Order matters: "Building No" is a vendor row-id we ignore, but a plain
    // "Building" / "Building Name" is the building itself.
    if (has('buildingno')) return ImportField.ignore;
    if (has('building')) return ImportField.building;
    if (has('country') || has('nationality')) return ImportField.nationality;
    if (has('rentalamount') || has('rentamount') || has('annualrent')) return ImportField.rentAmount;
    if (has('rentstart')) return ImportField.rentStart;
    if (has('rentend')) return ImportField.rentEnd;
    if (has('procedureparty') || has('partytype') || has('buyerseller')) return ImportField.partyType;
    if (has('procedurevalue') || has('transactionvalue') || has('worth') || has('price')) return ImportField.transactionValue;
    if (has('regis') || has('transactiondate') || has('instancedate')) return ImportField.transactionDate;
    if (has('masterproject') || has('mastercommunity')) return ImportField.community;
    if (has('subcommunity') || has('projectlnd') || has('project') || has('cluster')) return ImportField.cluster;
    if (has('community')) return ImportField.community;
    if (has('plotpre') || has('preregno') || has('plotno') || has('plotnumber')) return ImportField.plotNumber;
    if (has('unitnumber') || has('unitno') || h === 'unit') return ImportField.unitNumber;
    if (has('propertytype') || has('usagetype')) return ImportField.propertyType;
    if (has('bed')) return ImportField.beds;
    if (h === 'plot' || has('plotsize') || has('plotarea')) return ImportField.plotSqft;
    if (has('bua') || has('builtup') || has('actualarea') || h === 'size' || h === 'area' || has('sizesqft')) return ImportField.sizeSqft;
    if (has('mobile') || has('phone') || has('contactno') || h === 'tel') return ImportField.phone;
    if (has('name')) return ImportField.ownerName;
    return ImportField.ignore;
  }

  static detectType(columns: ColumnSpec[]): DataSetType {
    return columns.some(c => c.field === ImportField.partyType)
      ? DataSetType.transactions : DataSetType.register;
  }

  static normalizePhone(v: unknown): string | undefined {
    if (v == null) return undefined;
    const s = String(v).trim().toLowerCase();
    if (s.length === 0 || ['nan', 'null', 'n/a', 'na', '-', 'none', 'nil', '0'].includes(s)) return undefined;
    let d = s.replace(/\D/g, '');
    if (d.startsWith('00')) d = d.substring(2);
    if (d.length === 10 && d.startsWith('05')) d = '971' + d.substring(1);
    if (d.length === 9 && d.startsWith('5')) d = '971' + d;
    if (d.length < 7) return undefined;
    return d;
  }

  static dateOf(v: unknown): string | undefined {
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(1899, 11, 30);
      d.setDate(d.getDate() + v);
      return d.toISOString();
    }
    if (typeof v === 'string') {
      const trimmed = v.trim();
      const iso = new Date(trimmed);
      if (!isNaN(iso.getTime())) return iso.toISOString();
      const m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
      if (m) {
        const y = parseInt(m[3]);
        const d = new Date(y < 100 ? 2000 + y : y, parseInt(m[2]) - 1, parseInt(m[1]));
        return d.toISOString();
      }
    }
    return undefined;
  }

  static unitKeyFor(fields: {
    community: string; cluster?: string; building?: string;
    unitNumber?: string; plotNumber?: string;
  }): string | null {
    const u = norm(fields.unitNumber);
    if (u.length > 0) return `u|${norm(fields.community)}|${norm(fields.cluster)}|${norm(fields.building)}|${u}`;
    const p = norm(fields.plotNumber);
    if (p.length > 0) return `p|${norm(fields.community)}|${p}`;
    return null;
  }

  static dryRun(params: {
    sheet: ParsedSheet; headerRow: number; columns: ColumnSpec[];
    type: DataSetType; communityFallback: string; datasetId: string;
    existingByUnitKey: Map<string, Property>; now?: string;
  }): DryRunResult {
    const at = params.now ?? new Date().toISOString();
    const byField = new Map<ImportField, number>();
    for (const c of params.columns) {
      if (c.field !== ImportField.ignore) byField.set(c.field, c.index);
    }
    const cell = (row: unknown[], f: ImportField) => {
      const i = byField.get(f);
      return (i == null || i >= row.length) ? null : row[i];
    };
    // Columns the user didn't map to a known field, but that carry a real header —
    // kept verbatim per row so the table stays flexible to any upload.
    const extraCols = params.columns.filter(c =>
      c.field === ImportField.ignore && !!c.header && !/^Column \d+$/.test(c.header));
    const dataRows = params.sheet.rows.slice(params.headerRow + 1);
    let invalid = 0, inFileDup = 0;

    interface ParsedRow {
      unitKey: string; community: string; cluster?: string; building?: string;
      unitNumber?: string; plotNumber?: string; propertyType?: string;
      beds?: number; sizeSqft?: number; plotSqft?: number;
      txDate?: string; txValue?: number; party: string;
      ownerName: string; phone?: string; nationality?: string;
      rentStart?: string; rentEnd?: string; rentAmount?: number;
      extra: Record<string, string>;
    }

    const parsed: ParsedRow[] = [];
    for (const row of dataRows) {
      if (row.every(c => c == null)) continue;
      const extra: Record<string, string> = {};
      for (const c of extraCols) {
        const s = str(c.index < row.length ? row[c.index] : null);
        if (s) extra[c.header] = s;
      }
      const community = str(cell(row, ImportField.community)) ?? params.communityFallback;
      const cluster = str(cell(row, ImportField.cluster));
      const building = str(cell(row, ImportField.building));
      const unitNumber = str(cell(row, ImportField.unitNumber));
      const plotNumber = str(cell(row, ImportField.plotNumber));
      const key = this.unitKeyFor({ community, cluster, building, unitNumber, plotNumber });
      if (key == null) { invalid++; continue; }
      const partyRaw = (str(cell(row, ImportField.partyType)) ?? '').toLowerCase();
      parsed.push({
        unitKey: key, community, cluster, building, unitNumber, plotNumber,
        propertyType: str(cell(row, ImportField.propertyType)),
        beds: int(cell(row, ImportField.beds)),
        sizeSqft: num(cell(row, ImportField.sizeSqft)),
        plotSqft: num(cell(row, ImportField.plotSqft)),
        txDate: this.dateOf(cell(row, ImportField.transactionDate)),
        txValue: num(cell(row, ImportField.transactionValue)),
        party: partyRaw.includes('buy') ? 'buyer' : partyRaw.includes('sell') ? 'seller' : '',
        ownerName: str(cell(row, ImportField.ownerName)) ?? '',
        phone: this.normalizePhone(cell(row, ImportField.phone)),
        nationality: str(cell(row, ImportField.nationality)),
        rentStart: this.dateOf(cell(row, ImportField.rentStart)),
        rentEnd: this.dateOf(cell(row, ImportField.rentEnd)),
        rentAmount: num(cell(row, ImportField.rentAmount)),
        extra,
      });
    }

    const units = new Map<string, Property>();
    let seq = 0;
    const nextId = () => `p-${Date.now()}-${String(seq++).padStart(5, '0')}`;

    if (params.type === DataSetType.register) {
      for (const r of parsed) {
        if (units.has(r.unitKey)) inFileDup++;
        const prop = new Property(
          nextId(), kOrgId, params.datasetId, PropertyState.pool,
          r.unitKey, r.community, r.cluster, r.building, r.unitNumber,
          r.plotNumber, r.propertyType, r.beds, r.sizeSqft, r.plotSqft,
          r.txDate, r.txValue, r.txDate ? 1 : 0,
          r.rentStart, r.rentEnd, r.rentAmount,
          new OwnerInfo(r.ownerName, r.phone, r.nationality),
          at, at,
        );
        prop.extra = r.extra;
        units.set(r.unitKey, prop);
      }
    } else {
      const groups = new Map<string, number[]>();
      for (let i = 0; i < parsed.length; i++) {
        if (!groups.has(parsed[i].unitKey)) groups.set(parsed[i].unitKey, []);
        groups.get(parsed[i].unitKey)!.push(i);
      }
      for (const [key, indices] of Array.from(groups.entries())) {
        const rows = indices.map(i => parsed[i]);
        const dates = new Set(rows.filter(r => r.txDate).map(r => r.txDate));
        let owners = rows.filter(r => r.party === 'buyer');
        if (owners.length === 0) owners = rows;
        owners.sort((a, b) => {
          const d = (a.txDate ?? '1900').localeCompare(b.txDate ?? '1900');
          if (d !== 0) return d;
          return (a.phone ? 1 : 0) - (b.phone ? 1 : 0);
        });
        const ownerRow = owners[owners.length - 1];
        let lastDate: string | undefined, lastValue: number | undefined;
        for (const r of rows) {
          if (r.txDate && (lastDate == null || r.txDate > lastDate)) {
            lastDate = r.txDate; lastValue = r.txValue;
          }
        }
        const prop = new Property(
          nextId(), kOrgId, params.datasetId, PropertyState.pool,
          key, ownerRow.community, ownerRow.cluster, ownerRow.building,
          ownerRow.unitNumber, ownerRow.plotNumber, ownerRow.propertyType,
          ownerRow.beds, ownerRow.sizeSqft, ownerRow.plotSqft,
          lastDate, lastValue, dates.size,
          ownerRow.rentStart, ownerRow.rentEnd, ownerRow.rentAmount,
          new OwnerInfo(ownerRow.ownerName, ownerRow.phone, ownerRow.nationality),
          at, at,
        );
        // Merge extra across the unit's rows (later rows win).
        prop.extra = Object.assign({}, ...rows.map(r => r.extra));
        units.set(key, prop);
      }
    }

    const newProps: Property[] = [];
    const updated: Property[] = [];
    for (const candidate of Array.from(units.values())) {
      const existing = params.existingByUnitKey.get(candidate.unitKey);
      if (existing == null) { newProps.push(candidate); continue; }
      const newerTx = candidate.lastTransactionDate != null &&
        (existing.lastTransactionDate == null ||
          candidate.lastTransactionDate > existing.lastTransactionDate);
      updated.push(existing.copyWith({
        datasetId: candidate.datasetId,
        owner: (candidate.owner.name.length > 0 || candidate.owner.phone != null)
          ? candidate.owner : existing.owner,
        propertyType: candidate.propertyType,
        beds: candidate.beds,
        sizeSqft: candidate.sizeSqft,
        plotSqft: candidate.plotSqft,
        // Keep the existing transaction history unless the incoming file has a
        // newer one. These must name the existing value explicitly: copyWith
        // ends in Object.assign, which COPIES an explicit `undefined` rather
        // than skipping it — passing undefined here wiped the field, blanking
        // the vault's "Last transaction" column (and resetting txCount to 0 via
        // fromJson's `?? 0`) on every re-import of a vendor register.
        lastTransactionDate: newerTx ? candidate.lastTransactionDate : existing.lastTransactionDate,
        lastTransactionValue: newerTx ? candidate.lastTransactionValue : existing.lastTransactionValue,
        txCount: Math.max(candidate.txCount, existing.txCount),
        rentStart: candidate.rentStart,
        rentEnd: candidate.rentEnd,
        rentAmount: candidate.rentAmount,
        extra: { ...existing.extra, ...candidate.extra },
        updatedAt: at,
      }));
    }

    return new DryRunResult(
      params.type,
      dataRows.filter(r => r.some(c => c != null)).length,
      invalid, params.type === DataSetType.register ? inFileDup : 0,
      newProps, updated,
    );
  }
}

function str(v: unknown): string | undefined {
  const s = v?.toString().trim();
  return (s == null || s.length === 0) ? undefined : s;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, ''));
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n != null ? Math.floor(n) : undefined;
}

function norm(s?: string): string {
  if (s == null) return '';
  let t = s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t.length <= 9 && /^\d+$/.test(t)) t = parseInt(t).toString();
  return t;
}
