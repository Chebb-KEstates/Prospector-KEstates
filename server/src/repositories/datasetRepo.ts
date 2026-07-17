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
  );
}

const COLS = `
  id, org_id, name, source, type, module, file_name, community_label,
  imported_at, cost, total_units, callable_units, updated_units`;

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
