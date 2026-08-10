import { Property, OwnerInfo, DataSetType, kOrgId, PropertyState } from '../types/models';
import type { PhoneEntry } from '../types/models';
import { ImportField, ColumnSpec, ParsedSheet, DryRunResult, EXTRA_BACKED_FIELDS, emptyChangeTally } from './importModels';

/** How an update treats the owner(s) a file lists for a unit already on file. */
export type OwnerMode = 'replace' | 'patch';

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
    // Two columns both read as the master community (e.g. "Development" AND
    // "Community")? The later/weaker one is really the sub-community — demote it
    // to cluster when cluster is still free, so both survive instead of one
    // being dropped as a duplicate below.
    const communityCols = specs.filter(s => s.field === ImportField.community);
    if (communityCols.length > 1 && !specs.some(s => s.field === ImportField.cluster)) {
      const isMaster = (hdr: string) => /master|development/i.test(hdr);
      const master = communityCols.find(s => isMaster(s.header)) ?? communityCols[0];
      const demote = communityCols.find(s => s !== master);
      if (demote) demote.field = ImportField.cluster;
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
    // Rental STATUS ("New" / "Renewed" / "No Rental") before amount/dates so it
    // isn't swallowed by the "rental…" rules below.
    if (has('rentalstatus') || has('rentstatus') || has('tenancystatus')) return ImportField.rentalStatus;
    if (has('rentalamount') || has('rentamount') || has('annualrent')) return ImportField.rentAmount;
    if (has('rentstart')) return ImportField.rentStart;
    if (has('rentend')) return ImportField.rentEnd;
    // Sale type ("Initial Sale" / "Resale") is a descriptive tag — check before
    // the generic property-"type" rule so it doesn't become the property type.
    if (has('saletype') || has('salestype') || has('transactiontype')) return ImportField.saleType;
    if (has('procedureparty') || has('partytype') || has('buyerseller')) return ImportField.partyType;
    if (has('procedurevalue') || has('transactionvalue') || has('worth') || has('price')) return ImportField.transactionValue;
    if (has('regis') || has('transactiondate') || has('instancedate')) return ImportField.transactionDate;
    // Master community first — "Development" and "Master Community/Project" are
    // the top level. A plain "Community" stays master for template/DLD sheets; a
    // SECOND community-like column is demoted to sub-community in buildColumns.
    if (has('masterproject') || has('mastercommunity') || has('development')) return ImportField.community;
    if (has('subcommunity') || has('projectlnd') || has('project') || has('cluster')) return ImportField.cluster;
    if (has('community')) return ImportField.community;
    if (has('plotpre') || has('preregno') || has('plotno') || has('plotnumber')) return ImportField.plotNumber;
    // Unit CODE ("DE Maple-V-1") is a reference/identifier, not the unit number.
    if (has('unitcode') || has('unitref') || has('unitid')) return ImportField.unitCode;
    if (has('unitnumber') || has('unitno') || h === 'unit') return ImportField.unitNumber;
    if (has('propertytype') || has('usagetype') || has('unittype') || h === 'type') return ImportField.propertyType;
    if (has('layout') || has('floorplan') || has('typecode')) return ImportField.layout;
    if (has('floor') || has('storey')) return ImportField.floor;
    if (has('bed')) return ImportField.beds;
    if (h === 'plot' || has('plotsize') || has('plotarea')) return ImportField.plotSqft;
    if (has('bua') || has('builtup') || has('actualarea') || h === 'size' || h === 'area' || has('sizesqft')) return ImportField.sizeSqft;
    if (has('mobile') || has('phone') || has('contactno') || h === 'tel') return ImportField.phone;
    if (has('name') || h === 'owner' || has('ownername')) return ImportField.ownerName;
    return ImportField.ignore;
  }

  /**
   * True for any header carrying a contact number — "Mobile", "Mobile 1",
   * "Mobile 2", "Phone", "Contact No"… A sheet may hold any number of these and
   * we keep them all, labelled by their header. autoMapHeader can only claim ONE
   * column for ImportField.phone (the primary); this finds the rest.
   */
  static isPhoneHeader(header: string): boolean {
    const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    return h.includes('mobile') || h.includes('phone') || h.includes('telephone') ||
      h.includes('contactno') || h === 'tel';
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
    /**
     * Update mode: a matched unit KEEPS its own `datasetId` instead of being
     * re-tagged to `params.datasetId`. New units still take `params.datasetId`
     * (the set being updated). Off by default, so a fresh import re-tags as
     * before.
     */
    keepExistingDataset?: boolean;
    /**
     * How a matched unit's owner(s) are reconciled with the file:
     *   • 'replace' (default) — the file is the full owner list for that unit, so
     *     its owners replace what's on file (lets "was 2 owners, now 1" work). A
     *     blank owner row never wipes — it's treated as "not provided".
     *   • 'patch' — add-only: keep every existing owner/number, add any the file
     *     introduces, never remove one.
     */
    ownerMode?: OwnerMode;
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
    // Every contact-number column, in sheet order: the one mapped to `phone`
    // plus any further Mobile 2 / Mobile 3 … left unmapped. First valid number
    // becomes the primary; the rest are kept, labelled by their header.
    const phoneCols = params.columns
      .filter(c => c.field === ImportField.phone ||
        (c.field === ImportField.ignore && this.isPhoneHeader(c.header)))
      .sort((a, b) => a.index - b.index);

    // Columns the user didn't map to a known field, but that carry a real header —
    // kept verbatim per row so the table stays flexible to any upload. Phone
    // columns are excluded: they become labelled numbers, not text columns.
    const extraCols = params.columns.filter(c =>
      c.field === ImportField.ignore && !!c.header && !/^Column \d+$/.test(c.header) &&
      !this.isPhoneHeader(c.header));
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
      phones: PhoneEntry[];
    }

    const parsed: ParsedRow[] = [];
    for (const row of dataRows) {
      if (row.every(c => c == null)) continue;
      const extra: Record<string, string> = {};
      for (const c of extraCols) {
        const s = str(c.index < row.length ? row[c.index] : null);
        if (s) extra[c.header] = s;
      }
      // Named-but-extra-backed fields (Unit code, Layout, Floor, Sale type,
      // Rental status): mapped to a canonical key so they show as their own
      // column without a dedicated model field.
      for (const [f, key] of EXTRA_BACKED_FIELDS) {
        const s = str(cell(row, f));
        if (s) extra[key] = s;
      }
      // Every number on the row, labelled by its column header, de-duped.
      const phones: PhoneEntry[] = [];
      const seenNumbers = new Set<string>();
      for (const c of phoneCols) {
        const n = this.normalizePhone(c.index < row.length ? row[c.index] : null);
        if (n && !seenNumbers.has(n)) {
          seenNumbers.add(n);
          phones.push({ label: c.header.trim() || 'Mobile', number: n });
        }
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
        phone: phones[0]?.number,   // primary = first number on the row
        phones,
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
    const mkOwner = (r: ParsedRow) => {
      const o = new OwnerInfo(r.ownerName, r.phone, r.nationality);
      o.phones = r.phones;
      return o;
    };

    if (params.type === DataSetType.register) {
      for (const r of parsed) {
        const owner = mkOwner(r);
        const existing = units.get(r.unitKey);
        if (existing) {
          // Same unit, seen before. The register lists each owner on their own
          // row: a NEW owner is a co-owner (keep them, with their own number);
          // the SAME owner again is a genuine duplicate row.
          const key = ownerDedupKey(owner);
          if (existing.owners.some(o => ownerDedupKey(o) === key)) inFileDup++;
          else existing.owners.push(owner);
          continue;
        }
        const prop = new Property(
          nextId(), kOrgId, params.datasetId, PropertyState.pool,
          r.unitKey, r.community, r.cluster, r.building, r.unitNumber,
          r.plotNumber, r.propertyType, r.beds, r.sizeSqft, r.plotSqft,
          r.txDate, r.txValue, r.txDate ? 1 : 0,
          r.rentStart, r.rentEnd, r.rentAmount,
          owner, // primary = the first row's owner
          at, at,
        );
        prop.extra = r.extra;
        prop.owners = [owner];
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
          mkOwner(ownerRow),
          at, at,
        );
        prop.owners = [mkOwner(ownerRow)];
        // Merge extra across the unit's rows (later rows win).
        prop.extra = Object.assign({}, ...rows.map(r => r.extra));
        units.set(key, prop);
      }
    }

    const newProps: Property[] = [];
    const updated: Property[] = [];
    const ownerMode: OwnerMode = params.ownerMode ?? 'replace';
    const changes = emptyChangeTally();
    for (const candidate of Array.from(units.values())) {
      const existing = params.existingByUnitKey.get(candidate.unitKey);
      if (existing == null) { newProps.push(candidate); continue; }
      const newerTx = candidate.lastTransactionDate != null &&
        (existing.lastTransactionDate == null ||
          candidate.lastTransactionDate > existing.lastTransactionDate);
      // BLANK = NO CHANGE. copyWith ends in Object.assign, which COPIES an
      // explicit `undefined` rather than skipping it — so passing a blank cell
      // straight through wipes the field. Every scalar therefore falls back to
      // the existing value when the incoming cell is empty, and the owner is
      // merged field-by-field. This is what lets an "update" sheet carry only
      // the changed columns without erasing everything it leaves blank.
      const mergedPrimary = new OwnerInfo(
        candidate.owner.name.length > 0 ? candidate.owner.name : existing.owner.name,
        candidate.owner.phone ?? existing.owner.phone,
        candidate.owner.nationality ?? existing.owner.nationality,
      );
      mergedPrimary.phones = candidate.owner.phones.length > 0 ? candidate.owner.phones : existing.owner.phones;

      // ── Owner SET reconciliation (the per-upload replace/patch choice) ───────
      // "Does the file give owner data for this unit?" A blank owner row must
      // never wipe owners the file simply didn't re-send, in EITHER mode.
      const fileHasOwner = candidate.owner.name.trim().length > 0 || !!candidate.owner.phone;
      let effectiveOwners: OwnerInfo[];
      if (!fileHasOwner) {
        effectiveOwners = existing.allOwners;
      } else if (ownerMode === 'patch') {
        // Add-only: keep every existing owner, fold the file's owners in by name
        // (new numbers extend the matching owner; unknown names are appended).
        effectiveOwners = patchOwners(existing.allOwners, candidate.allOwners);
      } else {
        // Replace: the file is authoritative for this unit's owners. Keep the
        // primary's blank-safe fills, take the file's co-owners as the set.
        effectiveOwners = [mergedPrimary, ...candidate.allOwners.slice(1).map(cloneOwner)];
      }
      const primaryOwner = effectiveOwners[0] ?? mergedPrimary;
      // owners=[] means "single owner, told entirely by owner_*"; >1 stores co-owners.
      const coOwners = effectiveOwners.length > 1 ? effectiveOwners : [];

      // ── Tally what actually changes (for the review step) ────────────────────
      const beforeNums = allNumbers(existing.allOwners);
      const afterNums = allNumbers(effectiveOwners);
      if (effectiveOwners.length !== existing.allOwners.length) changes.ownerCountChanges++;
      const primaryChanged =
        ownerNameKey(primaryOwner) !== ownerNameKey(existing.owner) ||
        (primaryOwner.phone ?? '') !== (existing.owner.phone ?? '');
      if (primaryChanged || effectiveOwners.length !== existing.allOwners.length) changes.ownerChanges++;
      if (!sameStringSet(beforeNums, afterNums)) changes.phoneChanges++;
      const mRentStart = candidate.rentStart ?? existing.rentStart;
      const mRentEnd = candidate.rentEnd ?? existing.rentEnd;
      const mRentAmount = candidate.rentAmount ?? existing.rentAmount;
      if (mRentStart !== existing.rentStart || mRentEnd !== existing.rentEnd || mRentAmount !== existing.rentAmount) {
        changes.rentalChanges++;
      }
      if (newerTx) changes.saleChanges++;
      if ((candidate.propertyType ?? existing.propertyType) !== existing.propertyType ||
          (candidate.beds ?? existing.beds) !== existing.beds ||
          (candidate.sizeSqft ?? existing.sizeSqft) !== existing.sizeSqft ||
          (candidate.plotSqft ?? existing.plotSqft) !== existing.plotSqft) {
        changes.physicalChanges++;
      }

      updated.push(existing.copyWith({
        // Update mode keeps the unit in its own set; a fresh import re-tags it.
        datasetId: params.keepExistingDataset ? existing.datasetId : candidate.datasetId,
        owner: primaryOwner,
        owners: coOwners,
        propertyType: candidate.propertyType ?? existing.propertyType,
        beds: candidate.beds ?? existing.beds,
        sizeSqft: candidate.sizeSqft ?? existing.sizeSqft,
        plotSqft: candidate.plotSqft ?? existing.plotSqft,
        // Keep the existing transaction history unless the incoming file has a
        // newer one (blanking it also reset txCount to 0 via fromJson's `?? 0`).
        lastTransactionDate: newerTx ? candidate.lastTransactionDate : existing.lastTransactionDate,
        lastTransactionValue: newerTx ? candidate.lastTransactionValue : existing.lastTransactionValue,
        txCount: Math.max(candidate.txCount, existing.txCount),
        rentStart: mRentStart,
        rentEnd: mRentEnd,
        rentAmount: mRentAmount,
        // extra only carries non-empty cells (see the extra-building loop), so a
        // blank never lands here; new columns add, existing keys survive.
        extra: { ...existing.extra, ...candidate.extra },
        updatedAt: at,
      }));
    }

    return new DryRunResult(
      params.type,
      dataRows.filter(r => r.some(c => c != null)).length,
      invalid, params.type === DataSetType.register ? inFileDup : 0,
      newProps, updated, changes,
    );
  }
}

/** Identity of an owner for co-owner de-duplication: their number, else name. */
function ownerDedupKey(o: OwnerInfo): string {
  return `${o.phone ?? ''}|${o.name.trim().toLowerCase()}`;
}

/** Owners are the same person when their names match (case/space-insensitive). */
function ownerNameKey(o: OwnerInfo): string { return o.name.trim().toLowerCase(); }

function cloneOwner(o: OwnerInfo): OwnerInfo {
  const c = new OwnerInfo(o.name, o.phone, o.nationality);
  c.phones = o.allPhones.map(p => ({ ...p }));
  return c;
}

/** Every distinct number across a set of owners (their own numbers, primary incl.). */
function allNumbers(owners: OwnerInfo[]): Set<string> {
  const s = new Set<string>();
  for (const o of owners) for (const p of o.allPhones) if (p.number) s.add(p.number);
  return s;
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  let same = true;
  a.forEach(x => { if (!b.has(x)) same = false; });
  return same;
}

/**
 * Add-only owner merge ("patch"): start from the existing owners, then fold in
 * each incoming owner — a matching name gains any new numbers (and fills a blank
 * nationality); an unknown name is appended as a new co-owner. Nothing is ever
 * removed, so a partial file can't drop a co-owner it simply didn't re-send.
 */
function patchOwners(existing: OwnerInfo[], incoming: OwnerInfo[]): OwnerInfo[] {
  const out = existing.map(cloneOwner);
  for (const inc of incoming) {
    if (inc.name.trim().length === 0 && !inc.phone) continue;
    const match = inc.name.trim().length > 0
      ? out.find(o => ownerNameKey(o) === ownerNameKey(inc))
      : undefined;
    if (match) {
      const numbers = new Set(match.phones.map(p => p.number));
      for (const p of inc.allPhones) {
        if (p.number && !numbers.has(p.number)) { numbers.add(p.number); match.phones.push({ ...p }); }
      }
      if (!match.phone && inc.phone) match.phone = inc.phone;
      if (!match.nationality && inc.nationality) match.nationality = inc.nationality;
    } else {
      out.push(cloneOwner(inc));
    }
  }
  return out;
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
