import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { DataSet, DataSetType, DataModule, kOrgId } from '../../../src/types/models';

function toDataSet(r: Row): DataSet {
  return new DataSet(
    r.id as string,
    (r.name as string) ?? '',
    (r.source as string) ?? '',
    r.type as DataSetType,
    r.module as DataModule,
    (r.file_name as string) ?? '',
    (r.community_label as string) ?? '',
    fromDb(r.imported_at)!,
    r.cost != null ? Number(r.cost) : undefined,
    Number(r.total_units ?? 0),
    Number(r.callable_units ?? 0),
    Number(r.updated_units ?? 0),
    fromDb(r.last_updated_at) ?? undefined,
    Number(r.update_count ?? 0),
  );
}

const COLS = `
  id, org_id, name, source, type, module, file_name, community_label,
  imported_at, cost, total_units, callable_units, updated_units,
  last_updated_at, update_count`;

export async function listDatasets(): Promise<DataSet[]> {
  const [rows] = await pool.query<Row[]>(
    `SELECT ${COLS} FROM datasets WHERE org_id = ? ORDER BY imported_at DESC`, [kOrgId],
  );
  return rows.map(toDataSet);
}

export async function findDatasetById(id: string, cx?: PoolConnection): Promise<DataSet | null> {
  const db = cx ?? pool;
  const [rows] = await db.query<Row[]>(`SELECT ${COLS} FROM datasets WHERE id = ? LIMIT 1`, [id]);
  return rows.length ? toDataSet(rows[0]) : null;
}

export async function insertDataset(
  d: DataSet, importedBy: string | null, cx?: PoolConnection,
): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `INSERT INTO datasets
       (id, org_id, name, source, type, module, file_name, community_label,
        imported_at, imported_by, cost, total_units, callable_units, updated_units)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.id, kOrgId, d.name, d.source, d.type, d.module, d.fileName,
      d.communityLabel, toDb(d.importedAt), importedBy,
      d.cost ?? null, d.totalUnits, d.callableUnits, d.updatedUnits,
    ],
  );
}

export async function deleteDataset(id: string, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query('DELETE FROM datasets WHERE id = ?', [id]);
}

/**
 * Edit a data set's own details — the fields a manager can safely correct after
 * the fact without re-importing: its name, source, community label and the price
 * paid. Only the keys present in `patch` are written (an absent key is left
 * alone; `cost: null` deliberately clears the recorded price). The imported rows
 * and the counts/dates are untouched — re-mapping columns needs a re-upload.
 */
export async function updateDatasetMeta(
  id: string,
  patch: { name?: string; source?: string; communityLabel?: string; cost?: number | null },
  cx?: PoolConnection,
): Promise<void> {
  const db = cx ?? pool;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
  if (patch.source !== undefined) { sets.push('source = ?'); vals.push(patch.source); }
  if (patch.communityLabel !== undefined) { sets.push('community_label = ?'); vals.push(patch.communityLabel); }
  if (patch.cost !== undefined) { sets.push('cost = ?'); vals.push(patch.cost); }
  if (sets.length === 0) return;
  vals.push(id);
  await db.query(`UPDATE datasets SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/**
 * Refresh a data set's counts after an UPDATE import (see importService).
 * `total_units`/`callable_units` are recomputed as live counts over the rows
 * that belong to the set — the only honest figure once units have been added or
 * their callability changed. `updated_units` accumulates the matched rows across
 * updates.
 *
 * `imported_at` is deliberately LEFT ALONE — it's the original import date. The
 * refresh is recorded in `last_updated_at` (when) and `update_count` (how many
 * times), and `file_name` reflects the latest file. So the Data Sets list stays
 * one row that clearly shows it was updated, and when.
 *
 * `costToAdd` (the price paid for this refreshed file) is ADDED to the set's
 * running cost, so the total spend on a data set stays right across updates.
 */
export async function refreshDatasetStats(
  id: string, matchedDelta: number, fileName: string, costToAdd?: number, cx?: PoolConnection,
): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `UPDATE datasets d SET
       total_units     = (SELECT COUNT(*) FROM properties WHERE dataset_id = d.id),
       callable_units  = (SELECT COUNT(*) FROM properties WHERE dataset_id = d.id AND callable = 1),
       updated_units   = updated_units + ?,
       update_count    = update_count + 1,
       cost            = COALESCE(cost, 0) + ?,
       file_name       = ?,
       last_updated_at = ?
     WHERE id = ?`,
    [matchedDelta, costToAdd ?? 0, fileName, toDb(new Date().toISOString()), id],
  );
}
