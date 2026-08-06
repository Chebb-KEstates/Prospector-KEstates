import * as XLSX from 'xlsx';
import { pool, Row, fromDb } from '../db/pool';
import { findDatasetById } from '../repositories/datasetRepo';
import { notFound } from '../http/errors';
import {
  CallOutcome, CallOutcomeLabel, PropertyState, PropertyStateLabel,
} from '../../../src/types/models';

/**
 * Build a downloadable Excel workbook for a data set — its CURRENT state plus
 * everything the team added. Three sheets:
 *   • Units    — one row per unit with its current details and owner contacts.
 *   • Calls    — one row per logged call (outcome, feedback, broker, when).
 *   • History  — key record events (assigned, revealed, edited, imported…).
 *
 * Built from what's already stored, so it always reflects the latest data —
 * updates, calls, feedback and notes included. Manager-only; the export itself
 * is audited by the route.
 */

function dateOnly(v: unknown): string {
  const iso = fromDb(v);
  return iso ? iso.slice(0, 10) : '';
}

function dateTime(v: unknown): string {
  const iso = fromDb(v);
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

function num(v: unknown): number | '' {
  return v == null ? '' : Number(v);
}

/** owner_phones is a JSON array of { label, number }. */
function phoneList(v: unknown): string[] {
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => String((p as { number?: unknown }).number ?? '')).filter(Boolean);
  } catch { return []; }
}

/** owners is a JSON array of owner objects (name + own phones) when there are several. */
function ownerNames(primary: string, v: unknown): string {
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (!Array.isArray(arr) || arr.length === 0) return primary;
    const names = arr
      .map((o) => String((o as { name?: unknown }).name ?? '').trim())
      .filter(Boolean);
    return names.length ? Array.from(new Set(names)).join('; ') : primary;
  } catch { return primary; }
}

function rentalStatus(rentEnd: unknown, rentAmount: unknown): string {
  const end = fromDb(rentEnd);
  const hasLease = end != null || rentAmount != null;
  if (!hasLease) return 'Vacant';
  if (end && new Date(end) < new Date()) return 'Lease ended';
  return 'Rented';
}

export async function buildDatasetWorkbook(datasetId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const ds = await findDatasetById(datasetId);
  if (!ds) throw notFound('That data set no longer exists.');

  const [units] = await pool.query<Row[]>(
    `SELECT id, community, cluster, building, unit_number, plot_number, property_type,
            beds, size_sqft, plot_sqft, last_transaction_date, last_transaction_value,
            rent_start, rent_end, rent_amount, owner_name, owner_phones, owners,
            owner_nationality, state, notes, last_outcome, last_called_at, call_attempts
       FROM properties
      WHERE dataset_id = ?
      ORDER BY unit_sort_key IS NULL, unit_sort_key, unit_number`,
    [datasetId],
  );

  // A unit label for the Calls / History sheets, and to resolve property_id → label.
  const labelById = new Map<string, string>();
  const unitLabel = (r: Row) =>
    String(r.unit_number || [r.community, r.building].filter(Boolean).join(' ') || r.id);

  // ── Units sheet ───────────────────────────────────────────────────────────
  const unitHeaders = [
    'Community', 'Sub-community', 'Building', 'Unit', 'Plot', 'Type', 'Beds',
    'BUA (sqft)', 'Plot (sqft)', 'Last sale date', 'Last sale value',
    'Rental status', 'Rent start', 'Rent end', 'Rent amount',
    'Owner(s)', 'Nationality', 'Mobile 1', 'Mobile 2', 'Mobile 3', 'Mobile 4',
    'State', 'Last outcome', 'Last called', 'Calls', 'Notes',
  ];
  const unitRows = units.map((r) => {
    labelById.set(r.id as string, unitLabel(r));
    const phones = phoneList(r.owner_phones);
    const outcome = r.last_outcome as CallOutcome | null;
    const state = r.state as PropertyState;
    return [
      r.community ?? '', r.cluster ?? '', r.building ?? '', r.unit_number ?? '',
      r.plot_number ?? '', r.property_type ?? '', num(r.beds),
      num(r.size_sqft), num(r.plot_sqft),
      dateOnly(r.last_transaction_date), num(r.last_transaction_value),
      rentalStatus(r.rent_end, r.rent_amount),
      dateOnly(r.rent_start), dateOnly(r.rent_end), num(r.rent_amount),
      ownerNames(String(r.owner_name ?? ''), r.owners), r.owner_nationality ?? '',
      phones[0] ?? '', phones[1] ?? '', phones[2] ?? '', phones[3] ?? '',
      state ? (PropertyStateLabel[state] ?? state) : '',
      outcome ? (CallOutcomeLabel[outcome] ?? outcome) : '',
      dateTime(r.last_called_at), num(r.call_attempts),
      r.notes ?? '',
    ];
  });

  // ── Calls sheet ───────────────────────────────────────────────────────────
  const [calls] = units.length
    ? await pool.query<Row[]>(
      `SELECT cp.property_id, c.outcome, c.note, c.owner_name, c.at, c.follow_up_at,
              u.name AS broker_name
         FROM calls c
         JOIN call_properties cp ON cp.call_id = c.id
         LEFT JOIN users u ON u.id = c.broker_id
        WHERE cp.property_id IN (SELECT id FROM properties WHERE dataset_id = ?)
        ORDER BY c.at DESC`,
      [datasetId],
    )
    : [[]] as unknown as [Row[]];
  const callHeaders = ['Unit', 'Owner called', 'Outcome', 'Feedback', 'Broker', 'When', 'Follow-up'];
  const callRows = calls.map((c) => {
    const outcome = c.outcome as CallOutcome;
    return [
      labelById.get(c.property_id as string) ?? '', c.owner_name ?? '',
      outcome ? (CallOutcomeLabel[outcome] ?? outcome) : '', c.note ?? '',
      c.broker_name ?? '', dateTime(c.at), dateTime(c.follow_up_at),
    ];
  });

  // ── History sheet ─────────────────────────────────────────────────────────
  // Record events, minus the noise: 'view' (a browse) and 'call' (in Calls).
  const [events] = units.length
    ? await pool.query<Row[]>(
      `SELECT ap.property_id, a.action, a.detail, a.at, u.name AS actor_name
         FROM audit a
         JOIN audit_properties ap ON ap.audit_id = a.id
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE ap.property_id IN (SELECT id FROM properties WHERE dataset_id = ?)
          AND a.action NOT IN ('view', 'call')
        ORDER BY a.at DESC`,
      [datasetId],
    )
    : [[]] as unknown as [Row[]];
  const historyHeaders = ['Unit', 'Event', 'Detail', 'By', 'When'];
  const historyRows = events.map((e) => [
    labelById.get(e.property_id as string) ?? '', e.action ?? '',
    e.detail ?? '', e.actor_name ?? '', dateTime(e.at),
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([unitHeaders, ...unitRows]), 'Units');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([callHeaders, ...callRows]), 'Calls');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([historyHeaders, ...historyRows]), 'History');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { buffer, fileName: `${ds.name}.xlsx` };
}
