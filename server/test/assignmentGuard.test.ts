import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { pool, closePool } from '../src/db/pool';
import { stageUpload, commitOwners } from '../src/services/importService';
import { assignProperties } from '../src/services/assignmentService';
import { queryProperties } from '../src/repositories/propertyRepo';
import { insertUser } from '../src/repositories/userRepo';
import { AppUser, UserRole } from '../../src/types/user';
import { DataModule, DataSetType, kOrgId } from '../../src/types/models';
import { ColumnSpec, ImportField } from '../../src/logic/importModels';
import { newUserId } from '../src/domain/ids';

/**
 * The owner-cohesion guarantee: an owner's units in ONE area belong to ONE
 * broker — two brokers must never work the same owner in the same area. A
 * different area of the same owner MAY go to a different broker (that's by
 * design). See assignmentService.assignProperties / approveRequest.
 */

function xlsxBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const col = (i: number, header: string, field: ImportField) => new ColumnSpec(i, header, field, 2, 2, []);

let manager: string, brokerX: string, brokerY: string;

test.before(async () => {
  manager = newUserId(); brokerX = newUserId(); brokerY = newUserId();
  const mk = (id: string, name: string, role: UserRole) => insertUser({
    user: new AppUser(id, name, `${id}@test.local`, role, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await mk(manager, 'Manager', UserRole.manager);
  await mk(brokerX, 'Broker X', UserRole.broker);
  await mk(brokerY, 'Broker Y', UserRole.broker);
});

async function wipe() {
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM datasets WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM import_sessions WHERE org_id = ?', [kOrgId]);
}

test('an owner in one area cannot be split across two brokers', async () => {
  await wipe();
  const rows = [
    ['Community', 'Building Name', 'Unit Number', 'Owner Name', 'Mobile', 'Beds'],
    ['Marina', 'Tower A', '101', 'Owner O', '971500000001', 2], // A — owner O, Marina
    ['Marina', 'Tower A', '102', 'Owner O', '971500000001', 2], // B — owner O, Marina (same owner)
    ['JVC',    'Tower B', '201', 'Owner O', '971500000001', 1], // C — owner O, JVC (other area)
    ['Marina', 'Tower A', '103', 'Owner P', '971500000009', 2], // D — different owner, Marina
  ];
  const columns = [
    col(0, 'Community', ImportField.community),
    col(1, 'Building Name', ImportField.building),
    col(2, 'Unit Number', ImportField.unitNumber),
    col(3, 'Owner Name', ImportField.ownerName),
    col(4, 'Mobile', ImportField.phone),
    col(5, 'Beds', ImportField.ignore),
  ];
  const s = await stageUpload({ fileName: 'g.xlsx', bytes: xlsxBuffer(rows), module: DataModule.owners, userId: manager });
  const { datasetId } = await commitOwners({
    sessionId: s.sessionId, userId: manager, sheetIndex: 0, headerRow: 0, columns,
    type: DataSetType.register, communityFallback: '', datasetName: 'Guard', source: 't',
  });

  const all = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows;
  const byNo = (n: string, community: string) => all.find(p => p.unitNumber === n && p.community === community)!;
  const A = byNo('101', 'Marina'), B = byNo('102', 'Marina'), C = byNo('201', 'JVC');

  // Simulate the split-risk state: X already holds A (Marina); B is loose in the pool
  // (e.g. the sweep freed it). This is exactly the situation that used to split an owner.
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=? WHERE id=?`, [brokerX, A.id]);

  // Y must NOT be able to take B — same owner, same area, already held by X.
  await assert.rejects(
    () => assignProperties([B.id], brokerY, manager),
    /already assigned to Broker X/i,
    "a second broker must be refused the owner's same-area unit",
  );

  // X CAN take B (same broker) — no split.
  await assignProperties([B.id], brokerX, manager);
  const bAfter = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows.find(p => p.id === B.id)!;
  assert.equal(bAfter.assignedTo, brokerX, 'the holding broker keeps their owner whole');

  // A DIFFERENT area of the same owner MAY go to Y — cross-area is allowed by design.
  await assignProperties([C.id], brokerY, manager);
  const cAfter = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows.find(p => p.id === C.id)!;
  assert.equal(cAfter.assignedTo, brokerY, 'a different area of the same owner can go to another broker');
});

test.after(async () => { await closePool(); });
