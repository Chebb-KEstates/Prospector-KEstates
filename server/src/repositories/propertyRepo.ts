import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import {
  Property, OwnerInfo, PropertyState, CallOutcome, VaultSettings, kOrgId,
} from '../../../src/types/models';
import type { PhoneEntry } from '../../../src/types/models';
import { ownerKeyOf } from '../../../src/logic/ownerGrouping';

/**
 * Properties (owner records).
 *
 * This is where the client's "load 50k rows and filter in memory" became real
 * SQL. Every filter the PropertyTable offered has an equivalent here, with the
 * same semantics — including the fiddly ones:
 *   - `outcome: 'none'` means "not called yet" (last_outcome IS NULL)
 *   - `callableOnly` maps to the generated `callable` column
 *   - the free-text search is a substring match over the same concatenated
 *     haystack the client built, and it drops owner_name when owner data is
 *     hidden (teaser / hideOwner), exactly as before.
 */

// ── Row ⇄ model ────────────────────────────────────────────────────────────

export function toProperty(r: Row): Property {
  const p = new Property(
    r.id as string,
    r.org_id as string,
    (r.dataset_id as string) ?? '',
    r.state as PropertyState,
    r.unit_key as string,
    (r.community as string) ?? '',
    (r.cluster as string) ?? undefined,
    (r.building as string) ?? undefined,
    (r.unit_number as string) ?? undefined,
    (r.plot_number as string) ?? undefined,
    (r.property_type as string) ?? undefined,
    r.beds != null ? Number(r.beds) : undefined,
    r.size_sqft != null ? Number(r.size_sqft) : undefined,
    r.plot_sqft != null ? Number(r.plot_sqft) : undefined,
    fromDb(r.last_transaction_date),
    r.last_transaction_value != null ? Number(r.last_transaction_value) : undefined,
    Number(r.tx_count ?? 0),
    fromDb(r.rent_start),
    fromDb(r.rent_end),
    r.rent_amount != null ? Number(r.rent_amount) : undefined,
    new OwnerInfo(
      (r.owner_name as string) ?? '',
      (r.owner_phone as string) ?? undefined,
      (r.owner_nationality as string) ?? undefined,
    ),
    fromDb(r.created_at)!,
    fromDb(r.updated_at),
  );
  p.state = r.state as PropertyState;
  p.assignedTo = (r.assigned_to as string) ?? undefined;
  p.assignedAt = fromDb(r.assigned_at);
  p.assignmentNote = (r.assignment_note as string) ?? undefined;
  p.cooldownUntil = fromDb(r.cooldown_until);
  p.portfolioSince = fromDb(r.portfolio_since);
  p.lastOutcome = (r.last_outcome as CallOutcome) ?? undefined;
  p.lastCalledAt = fromDb(r.last_called_at);
  p.callAttempts = Number(r.call_attempts ?? 0);
  p.nextFollowUpAt = fromDb(r.next_follow_up_at);
  p.dncAt = fromDb(r.dnc_at);
  p.assignmentExpiresAt = fromDb(r.assignment_expires_at);
  p.notes = (r.notes as string) ?? undefined;
  p.extra = parseExtra(r.extra);
  p.owner.phones = parsePhones(r.owner_phones);
  p.owners = parseOwners(r.owners);
  return p;
}

/**
 * owners is a JSON array of {name, phone, nationality, phones}. NULL means a
 * single owner (the owner_* columns hold them), and Property.allOwners falls
 * back to the primary — so single-owner rows need no `owners` value.
 */
function parseOwners(v: unknown): OwnerInfo[] {
  if (v == null) return [];
  const arr = typeof v === 'string' ? safeParse(v) : v;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(e => e && typeof e === 'object')
    .map(e => {
      const o = e as { name?: unknown; phone?: unknown; nationality?: unknown; phones?: unknown };
      const info = new OwnerInfo(
        String(o.name ?? ''),
        o.phone != null ? String(o.phone) : undefined,
        o.nationality != null ? String(o.nationality) : undefined,
      );
      info.phones = parsePhones(o.phones);
      return info;
    });
}

/**
 * owner_phones is a JSON array of { label, number }. NULL (every pre-migration
 * row) means "just the primary", and OwnerInfo.allPhones falls back to it — so
 * old rows keep working with no backfill.
 */
function parsePhones(v: unknown): PhoneEntry[] {
  if (v == null) return [];
  const arr = typeof v === 'string' ? safeParse(v) : v;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(e => e && typeof e === 'object' && (e as PhoneEntry).number)
    .map(e => ({
      label: String((e as PhoneEntry).label ?? 'Mobile'),
      number: String((e as PhoneEntry).number),
    }));
}

function parseExtra(v: unknown): Record<string, string> {
  if (v == null) return {};
  const obj = typeof v === 'string' ? safeParse(v) : v;
  if (obj == null || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, val]) => [k, String(val)]),
  );
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

const COLS = `
  id, org_id, dataset_id, state, unit_key, community, cluster, building,
  unit_number, plot_number, property_type, beds, size_sqft, plot_sqft,
  last_transaction_date, last_transaction_value, tx_count,
  rent_start, rent_end, rent_amount,
  owner_name, owner_phone, owner_phones, owners, owner_nationality, extra,
  created_at, updated_at, assigned_to, assigned_at, assignment_note,
  cooldown_until, portfolio_since, last_outcome, last_called_at,
  call_attempts, next_follow_up_at, dnc_at, assignment_expires_at, notes`;

/** Params for an INSERT/REPLACE of one property. Keep in sync with `PLACEHOLDERS`. */
function writeParams(p: Property): unknown[] {
  return [
    p.id, kOrgId, p.datasetId || null, p.state, p.unitKey,
    p.community, p.cluster ?? null, p.building ?? null,
    p.unitNumber ?? null, p.plotNumber ?? null, p.propertyType ?? null,
    p.beds ?? null, p.sizeSqft ?? null, p.plotSqft ?? null,
    toDb(p.lastTransactionDate), p.lastTransactionValue ?? null, p.txCount,
    toDb(p.rentStart), toDb(p.rentEnd), p.rentAmount ?? null,
    p.owner.name, p.owner.phone ?? null,
    // NULL rather than "[]" when there's only one number, so the column stays
    // meaningful: NULL = nothing beyond the primary.
    p.owner.phones && p.owner.phones.length > 0 ? JSON.stringify(p.owner.phones) : null,
    p.owner.nationality ?? null,
    // owner_key is written by the app using the SHARED ownerKeyOf(), so the
    // grouping SQL can never drift from the grouping the UI does.
    ownerKeyOf(p),
    JSON.stringify(p.extra ?? {}),
    toDb(p.createdAt), toDb(p.updatedAt),
    p.assignedTo ?? null, toDb(p.assignedAt), p.assignmentNote ?? null,
    toDb(p.cooldownUntil), toDb(p.portfolioSince),
    p.lastOutcome ?? null, toDb(p.lastCalledAt), p.callAttempts,
    toDb(p.nextFollowUpAt), toDb(p.dncAt), toDb(p.assignmentExpiresAt),
    // Co-owners only: a single owner lives in the owner_* columns, so NULL keeps
    // the column meaningful (NULL = one owner).
    p.owners.length > 1 ? JSON.stringify(p.owners.map(o => o.toJson())) : null,
  ];
}

const WRITE_COLS = `
  id, org_id, dataset_id, state, unit_key, community, cluster, building,
  unit_number, plot_number, property_type, beds, size_sqft, plot_sqft,
  last_transaction_date, last_transaction_value, tx_count,
  rent_start, rent_end, rent_amount,
  owner_name, owner_phone, owner_phones, owner_nationality, owner_key, extra,
  created_at, updated_at, assigned_to, assigned_at, assignment_note,
  cooldown_until, portfolio_since, last_outcome, last_called_at,
  call_attempts, next_follow_up_at, dnc_at, assignment_expires_at, owners`;
const PLACEHOLDERS = `(${new Array(40).fill('?').join(', ')})`;

/**
 * Upsert a batch. Chunked because MySQL's max_allowed_packet caps statement
 * size and imports are tens of thousands of rows — the same reason the
 * IndexedDB layer chunked at 2000.
 */
const CHUNK = 500;

export async function saveProperties(
  properties: Property[],
  cx?: PoolConnection,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (properties.length === 0) return;
  const db = cx ?? pool;

  for (let i = 0; i < properties.length; i += CHUNK) {
    const chunk = properties.slice(i, i + CHUNK);
    const sql = `
      INSERT INTO properties (${WRITE_COLS})
      VALUES ${chunk.map(() => PLACEHOLDERS).join(', ')}
      ON DUPLICATE KEY UPDATE
        dataset_id = VALUES(dataset_id), state = VALUES(state),
        -- unit_key must be updatable so a re-map can persist a corrected identity.
        -- A normal key-matched update keeps the same key (copyWith can't change it),
        -- so this is a no-op there; only a re-map (which rebuilds the key from the
        -- corrected mapping) actually changes it. Without this, the key stayed stale
        -- and the next update couldn't match the unit → it inserted a duplicate.
        unit_key = VALUES(unit_key),
        community = VALUES(community), cluster = VALUES(cluster), building = VALUES(building),
        unit_number = VALUES(unit_number), plot_number = VALUES(plot_number),
        property_type = VALUES(property_type), beds = VALUES(beds),
        size_sqft = VALUES(size_sqft), plot_sqft = VALUES(plot_sqft),
        last_transaction_date = VALUES(last_transaction_date),
        last_transaction_value = VALUES(last_transaction_value),
        tx_count = VALUES(tx_count), rent_start = VALUES(rent_start),
        rent_end = VALUES(rent_end), rent_amount = VALUES(rent_amount),
        owner_name = VALUES(owner_name), owner_phone = VALUES(owner_phone),
        owner_phones = VALUES(owner_phones),
        owner_nationality = VALUES(owner_nationality), owner_key = VALUES(owner_key),
        extra = VALUES(extra), updated_at = VALUES(updated_at),
        assigned_to = VALUES(assigned_to), assigned_at = VALUES(assigned_at),
        assignment_note = VALUES(assignment_note), cooldown_until = VALUES(cooldown_until),
        portfolio_since = VALUES(portfolio_since), last_outcome = VALUES(last_outcome),
        last_called_at = VALUES(last_called_at), call_attempts = VALUES(call_attempts),
        next_follow_up_at = VALUES(next_follow_up_at), dnc_at = VALUES(dnc_at),
        assignment_expires_at = VALUES(assignment_expires_at),
        owners = VALUES(owners)`;
    await db.query(sql, chunk.flatMap(writeParams));
    onProgress?.(Math.min(i + CHUNK, properties.length), properties.length);
  }
}

export async function findPropertyById(id: string, cx?: PoolConnection): Promise<Property | null> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(`SELECT ${COLS} FROM properties WHERE id = ? LIMIT 1`, [id]);
  return rows.length ? toProperty(rows[0]) : null;
}

export async function findPropertiesByIds(ids: string[], cx?: PoolConnection): Promise<Property[]> {
  if (ids.length === 0) return [];
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    `SELECT ${COLS} FROM properties WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  return rows.map(toProperty);
}

/** Every unit belonging to one owner — powers the dialer's grouped card. */
export async function findByOwnerKey(ownerKey: string): Promise<Property[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM properties WHERE org_id = ? AND owner_key = ?`,
    [kOrgId, ownerKey],
  );
  return rows.map(toProperty);
}

export async function findByUnitKeys(unitKeys: string[]): Promise<Map<string, Property>> {
  const out = new Map<string, Property>();
  if (unitKeys.length === 0) return out;
  for (let i = 0; i < unitKeys.length; i += 1000) {
    const chunk = unitKeys.slice(i, i + 1000);
    const [rows] = await pool.query<Row[]>(
      `SELECT ${COLS} FROM properties
       WHERE org_id = ? AND unit_key_hash IN (${chunk.map(() => 'UNHEX(SHA2(?, 256))').join(', ')})`,
      [kOrgId, ...chunk],
    );
    for (const r of rows) {
      const p = toProperty(r);
      out.set(p.unitKey, p);
    }
  }
  return out;
}

/** Every unit currently in a data set — used to match an UPDATE against the set's
 *  existing units by their recomputed identity (tolerant to column re-mapping),
 *  rather than trusting the stored key, which may predate the current identity. */
export async function findByDatasetId(datasetId: string): Promise<Property[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM properties WHERE org_id = ? AND dataset_id = ?`,
    [kOrgId, datasetId],
  );
  return rows.map(toProperty);
}

/** Assigned + portfolio units for a broker — mirrors VaultContext.assignedTo. */
export async function findAssignedTo(brokerId: string): Promise<Property[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM properties
     WHERE assigned_to = ? AND state IN ('assigned', 'portfolio')`,
    [brokerId],
  );
  return rows.map(toProperty);
}

// ── Query: filter / sort / paginate ────────────────────────────────────────

export interface PropertyFilter {
  search?: string;
  community?: string;
  cluster?: string;
  state?: PropertyState | '';
  beds?: number;
  nationality?: string;
  /** A CallOutcome, or the literal 'none' meaning "not called yet". */
  outcome?: string;
  txFrom?: string;
  txTo?: string;
  callableOnly?: boolean;
  /** Only units WITHOUT a number (the inverse of callableOnly). */
  noContactOnly?: boolean;
  assignedTo?: string;
  datasetId?: string;
  /** Restricts to these states — used by the broker pool/teaser views. */
  states?: PropertyState[];
  /** Drop owner_name from the search haystack (teaser / hideOwner). */
  ownerHidden?: boolean;
  /** Follow-up is due now or overdue — the broker's "Due follow-up" chip. */
  dueOnly?: boolean;
  /** Last outcome was interested (sell or rent) — the "Interested" chip. */
  interestedOnly?: boolean;
  /**
   * Held units whose assignment deadline lands within `expiringWithinHours` —
   * the broker's "Expiring soon" chip and the home "running out of time" list.
   */
  expiringSoon?: boolean;
  /** Window (hours) for `expiringSoon`; the route fills it from settings. */
  expiringWithinHours?: number;
  /**
   * Tenancy signal: 'vacant' (no rental), 'rented', or 'leaseSoon' (lease ends
   * within ~90 days). Derived from rent_end plus the imported "Rental status".
   */
  tenancy?: 'vacant' | 'rented' | 'leaseSoon';
  /**
   * "Called within" window — last_called_at on/after `calledFrom` and before
   * `calledTo`. UTC bounds, computed client-side from the broker's local period
   * (today / this week / last month …) so week-start and month edges follow the
   * caller's calendar.
   */
  calledFrom?: string;
  calledTo?: string;
  /** Exact property type (Villa / Apartment / …). */
  propertyType?: string;
  /** Last-sale price band (AED), inclusive. */
  valueFrom?: number;
  valueTo?: number;
  /** Built-up area (sqft) band, inclusive. */
  sizeFrom?: number;
  sizeTo?: number;
  /** Plot area (sqft) band, inclusive. */
  plotFrom?: number;
  plotTo?: number;
  /** Follow-up state: 'scheduled' (has one) or 'due' (scheduled and now due). */
  followUp?: 'scheduled' | 'due';
  /** Only units that carry a written note. */
  hasNotes?: boolean;
}

export interface PropertyQuery extends PropertyFilter {
  sortKey?: string;
  asc?: boolean;
  limit: number;
  offset: number;
}

/**
 * Sortable columns.
 *
 * An allow-list, not string interpolation — `sortKey` arrives from the client
 * and lands in an ORDER BY, which is the one place a bound parameter can't
 * protect you. Anything not in this map (or matching `extra:<header>`) is
 * ignored and falls back to the unit sort.
 */
const SORTABLE: Record<string, string> = {
  owner: 'LOWER(owner_name)',
  mobile: 'LOWER(owner_phone)',
  beds: 'beds',
  size: 'size_sqft',
  plotSize: 'plot_sqft',
  type: 'LOWER(property_type)',
  lastTx: 'last_transaction_date',
  tenancy: 'rent_end',
  outcome: 'last_outcome',
  calledAt: 'last_called_at',
  followUp: 'next_follow_up_at',
  state: 'state',
  nationality: 'LOWER(owner_nationality)',
  attempts: 'call_attempts',
  assignedAt: 'assigned_at',
  createdAt: 'created_at',
};

/**
 * The unit ordering: community → cluster → building → unit (or plot) number,
 * compared NATURALLY so a list reads "Unit 1, 2, 3 … 10, 100" rather than the
 * text order "1, 10, 100, 2" — and "Maple 2" before "Maple 10".
 *
 * `unit_sort_key` is a STORED generated column (migration 005) holding a
 * zero-padded key, indexed by (org_id, unit_sort_key). Doing this at write time
 * rather than per query is deliberate: sorting by the equivalent regex
 * expression measured 5-11x slower than the old text sort on 60k rows, whereas
 * the indexed column sorts without a filesort at all.
 *
 * `id` last guarantees a total order — without it, tied rows can shuffle between
 * pages and LIMIT/OFFSET pagination silently repeats or skips a row.
 */
const UNIT_SORT_TERMS: string[] = ['unit_sort_key', 'id'];

/** The unit ordering with `dir` applied to every term (not just the last). */
function unitSort(dir: 'ASC' | 'DESC' = 'ASC'): string {
  return UNIT_SORT_TERMS.map(t => `${t} ${dir}`).join(', ');
}

function buildWhere(f: PropertyFilter): { sql: string; params: unknown[] } {
  const where: string[] = ['org_id = ?'];
  const params: unknown[] = [kOrgId];

  if (f.community) { where.push('community = ?'); params.push(f.community); }
  if (f.cluster) { where.push('cluster = ?'); params.push(f.cluster); }
  if (f.state) { where.push('state = ?'); params.push(f.state); }
  if (f.states && f.states.length > 0) {
    where.push(`state IN (${f.states.map(() => '?').join(', ')})`);
    params.push(...f.states);
  }
  if (f.beds != null && !isNaN(f.beds)) { where.push('beds = ?'); params.push(f.beds); }
  if (f.nationality) { where.push('owner_nationality = ?'); params.push(f.nationality); }
  if (f.assignedTo) { where.push('assigned_to = ?'); params.push(f.assignedTo); }
  if (f.datasetId) { where.push('dataset_id = ?'); params.push(f.datasetId); }

  if (f.outcome) {
    if (f.outcome === 'none') {
      where.push('last_outcome IS NULL');
    } else {
      where.push('last_outcome = ?');
      params.push(f.outcome);
    }
  }
  if (f.callableOnly) where.push('callable = 1');
  if (f.noContactOnly) where.push('callable = 0');

  // The broker's quick chips. `dueOnly` compares against the server's clock,
  // where the client compared against the browser's — a difference of at most
  // clock skew, and the server is the one that owns "now" for cooldowns anyway.
  // UTC_TIMESTAMP, not NOW(): next_follow_up_at is written by the app as UTC
  // (the pool is opened with timezone 'Z'), and nothing re-checks this filter in
  // JS, so NOW() would surface follow-ups a whole UTC offset early.
  if (f.dueOnly) where.push('next_follow_up_at IS NOT NULL AND next_follow_up_at <= UTC_TIMESTAMP(3)');
  if (f.interestedOnly) {
    where.push(`last_outcome IN ('${CallOutcome.interestedSell}', '${CallOutcome.interestedRent}')`);
  }

  // Held units running out of time — the deadline is within the alert window
  // (or already past, awaiting the next sweep). Only assigned/portfolio units
  // carry a deadline, so the state check keeps pooled/cooling rows out.
  if (f.expiringSoon) {
    // The threshold comes from settings.expiringSoonHours; 0 turns the warning
    // off, so nothing matches. A null (feature requested without a setting)
    // falls back to 24h.
    const hours = f.expiringWithinHours ?? 24;
    if (hours <= 0) {
      where.push('1 = 0');
    } else {
      // UTC_TIMESTAMP, not NOW(): the app writes UTC into these columns (the pool
      // is opened with timezone 'Z'), while NOW() answers in the server's local
      // zone — comparing the two skews every deadline by the UTC offset.
      where.push(
        `state IN ('${PropertyState.assigned}', '${PropertyState.portfolio}') ` +
        `AND assignment_expires_at IS NOT NULL ` +
        `AND assignment_expires_at <= (UTC_TIMESTAMP(3) + INTERVAL ? HOUR)`,
      );
      params.push(hours);
    }
  }

  // Tenancy — a lease ending soon or a vacant unit is a live selling signal.
  // Read from rent_end plus the imported "Rental status" extra; all literals,
  // so no user input reaches the SQL.
  if (f.tenancy) {
    const status = `LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(extra, '$."Rental status"')), ''))`;
    const rented = `(rent_end IS NOT NULL OR rent_amount IS NOT NULL OR ${status} REGEXP 'new|renew|rented|leased|tenant')`;
    if (f.tenancy === 'vacant') {
      where.push(`(${status} REGEXP 'no rental|vacant' OR NOT ${rented})`);
    } else if (f.tenancy === 'rented') {
      where.push(rented);
    } else if (f.tenancy === 'leaseSoon') {
      // UTC_TIMESTAMP — rent_end is imported through toDb() and stored as UTC.
      where.push(
        'rent_end IS NOT NULL AND rent_end >= UTC_TIMESTAMP(3) ' +
        'AND rent_end <= (UTC_TIMESTAMP(3) + INTERVAL 90 DAY)',
      );
    }
  }

  // The client compared against a parsed date with no time component; a bare
  // `<= txTo` would exclude everything later that same day, so the upper bound
  // is exclusive-next-day to match "on or before this date".
  if (f.txFrom) {
    const d = new Date(f.txFrom);
    if (!isNaN(d.getTime())) { where.push('last_transaction_date >= ?'); params.push(d); }
  }
  if (f.txTo) {
    const d = new Date(f.txTo);
    if (!isNaN(d.getTime())) {
      const end = new Date(d.getTime() + 24 * 3600_000);
      where.push('last_transaction_date < ?');
      params.push(end);
    }
  }

  // "Called within" — the client sends exact UTC bounds for the chosen period, so
  // never-called units (last_called_at IS NULL) simply don't match.
  if (f.calledFrom) {
    const d = new Date(f.calledFrom);
    if (!isNaN(d.getTime())) { where.push('last_called_at >= ?'); params.push(d); }
  }
  if (f.calledTo) {
    const d = new Date(f.calledTo);
    if (!isNaN(d.getTime())) { where.push('last_called_at < ?'); params.push(d); }
  }

  if (f.propertyType) { where.push('property_type = ?'); params.push(f.propertyType); }

  // Numeric bands — last-sale price, built-up area, plot area. Each end is
  // optional so "from 1M with no ceiling" works. NaN guards keep a stray value
  // out of the SQL.
  const band = (col: string, from?: number, to?: number) => {
    if (from != null && !isNaN(from)) { where.push(`${col} >= ?`); params.push(from); }
    if (to != null && !isNaN(to)) { where.push(`${col} <= ?`); params.push(to); }
  };
  band('last_transaction_value', f.valueFrom, f.valueTo);
  band('size_sqft', f.sizeFrom, f.sizeTo);
  band('plot_sqft', f.plotFrom, f.plotTo);

  // Follow-up. UTC_TIMESTAMP for "due", matching dueOnly above (the column is
  // written as UTC).
  if (f.followUp === 'scheduled') where.push('next_follow_up_at IS NOT NULL');
  else if (f.followUp === 'due') where.push('next_follow_up_at IS NOT NULL AND next_follow_up_at <= UTC_TIMESTAMP(3)');

  if (f.hasNotes) where.push("notes IS NOT NULL AND notes <> ''");

  if (f.search && f.search.trim().length > 0) {
    // Substring match over the same haystack the client concatenated. LIKE
    // '%q%' cannot use an index, but it is what preserves the existing
    // behaviour exactly; the indexed filters above narrow the scan first.
    const q = `%${f.search.trim().replace(/[\\%_]/g, m => '\\' + m)}%`;
    const fields = [
      'community', "IFNULL(cluster, '')", "IFNULL(building, '')",
      "IFNULL(unit_number, '')", "IFNULL(plot_number, '')",
    ];
    if (!f.ownerHidden) fields.push('owner_name');
    where.push(`LOWER(CONCAT_WS(' ', ${fields.join(', ')})) LIKE LOWER(?)`);
    params.push(q);
  }

  return { sql: where.join(' AND '), params };
}

export interface PropertyPage {
  rows: Property[];
  total: number;
}

export async function queryProperties(q: PropertyQuery): Promise<PropertyPage> {
  const { sql: whereSql, params } = buildWhere(q);

  const [countRows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM properties WHERE ${whereSql}`,
    params,
  );
  const total = Number(countRows[0].n);

  const dir = q.asc === false ? 'DESC' : 'ASC';
  let orderBy: string;

  if (q.sortKey && q.sortKey.startsWith('extra:')) {
    // Dynamic upload columns live in JSON; sort by the extracted scalar.
    // The header is bound as a parameter — never interpolated into the path.
    orderBy = `LOWER(JSON_UNQUOTE(JSON_EXTRACT(extra, CONCAT('$.', ?)))) ${dir}, ${unitSort()}`;
    const header = q.sortKey.slice('extra:'.length);
    const [rows] = await pool.query<Row[]>(
      `SELECT ${COLS} FROM properties WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, header, q.limit, q.offset],
    );
    return { rows: rows.map(toProperty), total };
  }

  const mapped = q.sortKey ? SORTABLE[q.sortKey] : undefined;
  orderBy = mapped
    ? `${mapped} ${dir}, ${unitSort()}`
    : unitSort(dir);

  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM properties WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, q.limit, q.offset],
  );
  return { rows: rows.map(toProperty), total };
}

/**
 * Facets — the dropdown option lists.
 *
 * The client derived these by mapping the whole in-memory array. With
 * pagination those options must still reflect the *entire* matching set, not
 * the current page, so they get their own DISTINCT queries.
 */
export interface PropertyFacets {
  communities: string[];
  clusters: string[];
  states: PropertyState[];
  beds: number[];
  nationalities: string[];
  outcomes: CallOutcome[];
  propertyTypes: string[];
  extraKeys: string[];
}

export async function propertyFacets(f: PropertyFilter): Promise<PropertyFacets> {
  // Facets describe the scope (assignment/state), not the user's own dropdown
  // choices — otherwise picking a community would erase every other option.
  const scope: PropertyFilter = {
    assignedTo: f.assignedTo,
    datasetId: f.datasetId,
    states: f.states,
  };
  const { sql, params } = buildWhere(scope);

  const one = async (col: string) => {
    const [rows] = await pool.query<Row[]>(
      `SELECT DISTINCT ${col} AS v FROM properties WHERE ${sql} AND ${col} IS NOT NULL AND ${col} <> '' ORDER BY v`,
      params,
    );
    return rows.map(r => r.v);
  };

  const clusterScope = f.community
    ? buildWhere({ ...scope, community: f.community })
    : { sql, params };

  const [communities, states, beds, nationalities, outcomes, propertyTypes] = await Promise.all([
    one('community'),
    pool.query<Row[]>(`SELECT DISTINCT state AS v FROM properties WHERE ${sql}`, params)
      .then(([r]) => r.map(x => x.v as PropertyState)),
    pool.query<Row[]>(
      `SELECT DISTINCT beds AS v FROM properties WHERE ${sql} AND beds IS NOT NULL ORDER BY v`, params)
      .then(([r]) => r.map(x => Number(x.v))),
    one('owner_nationality'),
    pool.query<Row[]>(
      `SELECT DISTINCT last_outcome AS v FROM properties WHERE ${sql} AND last_outcome IS NOT NULL`, params)
      .then(([r]) => r.map(x => x.v as CallOutcome)),
    one('property_type'),
  ]);

  const [clusterRows] = await pool.query<Row[]>(
    `SELECT DISTINCT cluster AS v FROM properties
     WHERE ${clusterScope.sql} AND cluster IS NOT NULL AND cluster <> '' ORDER BY v`,
    clusterScope.params,
  );

  // Dynamic `extra` headers across the scope. JSON_KEYS per row then flatten —
  // there's no DISTINCT over JSON object keys in MySQL.
  const [extraRows] = await pool.query<Row[]>(
    `SELECT DISTINCT JSON_KEYS(extra) AS ks FROM properties
     WHERE ${sql} AND extra IS NOT NULL AND JSON_LENGTH(extra) > 0`,
    params,
  );
  const extraKeys = new Set<string>();
  for (const r of extraRows) {
    const ks = typeof r.ks === 'string' ? safeParse(r.ks) : r.ks;
    if (Array.isArray(ks)) for (const k of ks) extraKeys.add(String(k));
  }

  return {
    communities: communities.map(String),
    clusters: clusterRows.map(r => String(r.v)),
    states,
    beds,
    nationalities: nationalities.map(String),
    outcomes,
    propertyTypes: propertyTypes.map(String),
    extraKeys: Array.from(extraKeys).sort(),
  };
}

// ── Aggregates (dashboards) ────────────────────────────────────────────────

export async function countByState(): Promise<Record<PropertyState, number>> {
  const [rows] = await pool.query<Row[]>(
    'SELECT state, COUNT(*) AS n FROM properties WHERE org_id = ? GROUP BY state',
    [kOrgId],
  );
  const out = Object.fromEntries(
    Object.values(PropertyState).map(s => [s, 0]),
  ) as Record<PropertyState, number>;
  for (const r of rows) out[r.state as PropertyState] = Number(r.n);
  return out;
}

export async function countCallable(): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    'SELECT COUNT(*) AS n FROM properties WHERE org_id = ? AND callable = 1',
    [kOrgId],
  );
  return Number(rows[0].n);
}

export async function listCommunities(): Promise<string[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT DISTINCT community AS v FROM properties WHERE org_id = ? AND community <> '' ORDER BY v`,
    [kOrgId],
  );
  return rows.map(r => String(r.v));
}

export async function countTotal(): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    'SELECT COUNT(*) AS n FROM properties WHERE org_id = ?', [kOrgId],
  );
  return Number(rows[0].n);
}

/**
 * Distinct owners.
 *
 * The manager home showed `new Set(properties.map(ownerKeyOf)).size`. owner_key
 * is written from that same shared function, so this is the identical number
 * without shipping every row to the browser to count them.
 */
export async function countDistinctOwners(): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    'SELECT COUNT(DISTINCT owner_key) AS n FROM properties WHERE org_id = ?', [kOrgId],
  );
  return Number(rows[0].n);
}

/**
 * Portfolio units going stale — mirrors isPortfolioStale's lastCalledAt ?? portfolioSince.
 *
 * UTC_TIMESTAMP — both columns hold UTC (see buildWhere), and this count is
 * pure SQL with no JS re-check, so NOW() would call units stale a UTC offset early.
 */
export async function countStalePortfolio(staleDays: number): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM properties
     WHERE org_id = ? AND state = 'portfolio'
       AND COALESCE(last_called_at, portfolio_since) IS NOT NULL
       AND COALESCE(last_called_at, portfolio_since) <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)`,
    [kOrgId, staleDays],
  );
  return Number(rows[0].n);
}

/**
 * Held units whose assignment deadline lands within `hours` (or has already
 * passed, awaiting the next sweep) — the "running out of time" count. Pass a
 * `brokerId` for one broker's own at-risk units; omit for the whole org.
 */
export async function countExpiringSoon(hours: number, brokerId?: string): Promise<number> {
  // 0 = the "expiring soon" warning is off — nothing is ever "soon".
  if (hours <= 0) return 0;
  const where = [
    'org_id = ?',
    `state IN ('${PropertyState.assigned}', '${PropertyState.portfolio}')`,
    'assignment_expires_at IS NOT NULL',
    // UTC_TIMESTAMP — these columns hold UTC (see buildWhere).
    'assignment_expires_at <= (UTC_TIMESTAMP(3) + INTERVAL ? HOUR)',
  ];
  const params: unknown[] = [kOrgId, hours];
  if (brokerId) { where.push('assigned_to = ?'); params.push(brokerId); }
  const [rows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM properties WHERE ${where.join(' AND ')}`, params,
  );
  return Number(rows[0].n);
}

/** How many units each broker is holding — the board's "On list" column. */
export async function assignedCountByBroker(): Promise<Map<string, number>> {
  const [rows] = await pool.query<Row[]>(
    `SELECT assigned_to, COUNT(*) AS n FROM properties
     WHERE org_id = ? AND assigned_to IS NOT NULL AND state IN ('assigned', 'portfolio')
     GROUP BY assigned_to`,
    [kOrgId],
  );
  return new Map(rows.map(r => [r.assigned_to as string, Number(r.n)]));
}

/** Held units per broker, split by state — the Team screen's two columns. */
/**
 * Per-broker book coverage: of the callable units a broker currently holds
 * (assigned/portfolio), how many have actually been called. Feeds the Report's
 * "Coverage %" column — a snapshot of the current book, not a windowed figure.
 */
export async function callableCoverageByBroker(): Promise<Map<string, { callable: number; worked: number }>> {
  const [rows] = await pool.query<Row[]>(
    `SELECT assigned_to,
            SUM(callable = 1) AS callable,
            SUM(callable = 1 AND last_called_at IS NOT NULL) AS worked
     FROM properties
     WHERE org_id = ? AND assigned_to IS NOT NULL AND state IN ('assigned', 'portfolio')
     GROUP BY assigned_to`,
    [kOrgId],
  );
  return new Map(rows.map(r => [r.assigned_to as string, {
    callable: Number(r.callable ?? 0),
    worked: Number(r.worked ?? 0),
  }]));
}

/**
 * Per-broker follow-ups due now — held units whose next_follow_up_at has passed.
 * UTC_TIMESTAMP because the column is written as UTC (see the dueOnly filter).
 */
export async function followUpsDueByBroker(): Promise<Map<string, number>> {
  const [rows] = await pool.query<Row[]>(
    `SELECT assigned_to, COUNT(*) AS n FROM properties
     WHERE org_id = ? AND assigned_to IS NOT NULL AND state IN ('assigned', 'portfolio')
       AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= UTC_TIMESTAMP(3)
     GROUP BY assigned_to`,
    [kOrgId],
  );
  return new Map(rows.map(r => [r.assigned_to as string, Number(r.n)]));
}

export async function heldByBrokerAndState(): Promise<Map<string, { assigned: number; portfolio: number }>> {
  const [rows] = await pool.query<Row[]>(
    `SELECT assigned_to, state, COUNT(*) AS n FROM properties
     WHERE org_id = ? AND assigned_to IS NOT NULL AND state IN ('assigned', 'portfolio')
     GROUP BY assigned_to, state`,
    [kOrgId],
  );
  const out = new Map<string, { assigned: number; portfolio: number }>();
  for (const r of rows) {
    const id = r.assigned_to as string;
    const entry = out.get(id) ?? { assigned: 0, portfolio: 0 };
    if (r.state === 'assigned') entry.assigned = Number(r.n);
    else entry.portfolio = Number(r.n);
    out.set(id, entry);
  }
  return out;
}

/** Callable units that have actually been called — the "callable worked" figure. */
export async function countCallableWorked(): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM properties
     WHERE org_id = ? AND callable = 1 AND last_called_at IS NOT NULL`,
    [kOrgId],
  );
  return Number(rows[0].n);
}

/** Units worked per data set — the coverage bars. */
export async function workedByDataset(): Promise<Map<string, number>> {
  const [rows] = await pool.query<Row[]>(
    `SELECT dataset_id, COUNT(*) AS n FROM properties
     WHERE org_id = ? AND dataset_id IS NOT NULL AND last_called_at IS NOT NULL
     GROUP BY dataset_id`,
    [kOrgId],
  );
  return new Map(rows.map(r => [r.dataset_id as string, Number(r.n)]));
}

export async function deleteByDataset(datasetId: string, cx?: PoolConnection): Promise<number> {
  const db = cx ?? pool;
  const [res] = await db.query('DELETE FROM properties WHERE dataset_id = ?', [datasetId]);
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

export async function countByDataset(datasetId: string, cx?: PoolConnection): Promise<number> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(
    'SELECT COUNT(*) AS n FROM properties WHERE dataset_id = ?', [datasetId],
  );
  return Number(rows[0].n);
}

/** Set the free-text notes on one property (empty string clears them). */
/**
 * Save notes, and — because "updating a unit" is how a broker renews it —
 * push the assignment deadline out for a held unit: a portfolio unit gets a
 * fresh renewal window, an assigned unit a fresh SLA (still clamped to the hard
 * cap). Pooled / cooling / dnc rows are untouched.
 */
export async function updatePropertyNotes(
  id: string, notes: string, settings: VaultSettings, cx?: PoolConnection,
): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    // UTC_TIMESTAMP throughout — these columns hold UTC, so NOW() would write a
    // deadline shifted by the server's UTC offset. A 0 limit removes the timer:
    // the IF(? > 0, …, NULL) guards leave the unit with no deadline rather than
    // one that expires immediately.
    `UPDATE properties SET
       notes = ?, updated_at = ?,
       assignment_expires_at = CASE
         WHEN state = '${PropertyState.portfolio}'
           THEN IF(? > 0, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY), NULL)
         WHEN state = '${PropertyState.assigned}'
           THEN IF(? > 0,
                   IF(? > 0,
                      LEAST(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR),
                            DATE_ADD(COALESCE(assigned_at, UTC_TIMESTAMP(3)), INTERVAL ? DAY)),
                      DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR)),
                   NULL)
         ELSE assignment_expires_at
       END
     WHERE id = ?`,
    [
      notes.length > 0 ? notes : null, toDb(new Date().toISOString()),
      settings.portfolioRenewDays, settings.portfolioRenewDays,
      settings.assignmentSlaHours, settings.noAnswerMaxHoldDays,
      settings.assignmentSlaHours, settings.noAnswerMaxHoldDays, settings.assignmentSlaHours,
      id,
    ],
  );
}
