import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { pool, closePool } from '../src/db/pool';
import { stageUpload, commitOwners } from '../src/services/importService';
import { assignProperties, reclaimProperties } from '../src/services/assignmentService';
import { logCall, sweepLapsed } from '../src/services/callService';
import { queryProperties } from '../src/repositories/propertyRepo';
import { insertUser } from '../src/repositories/userRepo';
import { AppUser, UserRole } from '../../src/types/user';
import { DataModule, DataSetType, kOrgId, PropertyState, CallOutcome } from '../../src/types/models';
import { ColumnSpec, ImportField } from '../../src/logic/importModels';
import { newUserId } from '../src/domain/ids';

/**
 * Owner-in-area cohesion: an owner's units in ONE area (community) are one
 * indivisible group. They assign, reassign, reclaim and recycle together; a
 * "do not call" applies to the whole owner. A DIFFERENT area of the same owner
 * is independent (may sit with another broker).
 */

function xlsxBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const col = (i: number, header: string, field: ImportField) => new ColumnSpec(i, header, field, 2, 2, []);
const COLUMNS = [
  col(0, 'Community', ImportField.community),
  col(1, 'Building Name', ImportField.building),
  col(2, 'Unit Number', ImportField.unitNumber),
  col(3, 'Owner Name', ImportField.ownerName),
  col(4, 'Mobile', ImportField.phone),
];

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
  await pool.query('DELETE FROM calls WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM datasets WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM import_sessions WHERE org_id = ?', [kOrgId]);
}

/** Import a fixed owner map and return the units keyed by "unit@community". */
async function seed(rows: unknown[][]) {
  await wipe();
  const s = await stageUpload({ fileName: 'c.xlsx', bytes: xlsxBuffer([['Community', 'Building Name', 'Unit Number', 'Owner Name', 'Mobile'], ...rows]), module: DataModule.owners, userId: manager });
  const { datasetId } = await commitOwners({
    sessionId: s.sessionId, userId: manager, sheetIndex: 0, headerRow: 0, columns: COLUMNS,
    type: DataSetType.register, communityFallback: '', datasetName: 'Cohesion', source: 't',
  });
  return datasetId;
}
async function load(datasetId: string) {
  const all = (await queryProperties({ datasetId, limit: 200, offset: 0 } as any)).rows;
  const at = (unit: string, community: string) => all.find(p => p.unitNumber === unit && p.community === community)!;
  return { all, at };
}

// Owner O: 101 + 102 in Marina, 201 in JVC. Owner P: 103 in Marina.
const OWNER_MAP: unknown[][] = [
  ['Marina', 'Tower A', '101', 'Owner O', '971500000001'],
  ['Marina', 'Tower A', '102', 'Owner O', '971500000001'],
  ['JVC',    'Tower B', '201', 'Owner O', '971500000001'],
  ['Marina', 'Tower A', '103', 'Owner P', '971500000009'],
];

test('reassigning one unit moves the whole same-area group; other areas untouched', async () => {
  const ds = await seed(OWNER_MAP);
  const { at } = await load(ds);
  const A = at('101', 'Marina'), B = at('102', 'Marina'), C = at('201', 'JVC'), D = at('103', 'Marina');

  // X holds A; B is loose in the pool (e.g. freed earlier).
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=?, assignment_expires_at=(UTC_TIMESTAMP()+INTERVAL 2 DAY) WHERE id=?`, [brokerX, A.id]);

  // Manager gives B to Y → the WHOLE Marina group (A too) moves to Y.
  await assignProperties([B.id], brokerY, manager);
  const after = await load(ds);
  assert.equal(after.at('101', 'Marina').assignedTo, brokerY, 'A reassigned with the group');
  assert.equal(after.at('102', 'Marina').assignedTo, brokerY, 'B assigned to Y');
  assert.equal(after.at('201', 'JVC').assignedTo, undefined, 'the JVC unit (other area) is untouched');
  assert.equal(after.at('103', 'Marina').assignedTo, undefined, 'a different owner is untouched');
  void C; void D;
});

test('reclaiming one unit reclaims the whole same-area group', async () => {
  const ds = await seed(OWNER_MAP);
  const { at } = await load(ds);
  const A = at('101', 'Marina'), B = at('102', 'Marina');
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=?, assignment_expires_at=(UTC_TIMESTAMP()+INTERVAL 2 DAY) WHERE id IN (?,?)`, [brokerX, A.id, B.id]);

  await reclaimProperties([A.id], manager);
  const after = await load(ds);
  assert.equal(after.at('101', 'Marina').state, PropertyState.pool, 'A reclaimed');
  assert.equal(after.at('102', 'Marina').state, PropertyState.pool, 'B reclaimed with the group');
  assert.equal(after.at('102', 'Marina').assignedTo, undefined);
});

test('a "do not call" applies to the whole owner in that area (held and pooled)', async () => {
  const ds = await seed(OWNER_MAP);
  const { at } = await load(ds);
  const A = at('101', 'Marina'), B = at('102', 'Marina'), C = at('201', 'JVC');
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=?, assignment_expires_at=(UTC_TIMESTAMP()+INTERVAL 2 DAY) WHERE id=?`, [brokerX, A.id]);
  // B stays pooled — DNC must reach it too. (C is a different area.)

  await logCall({ propertyIds: [A.id], brokerId: brokerX, isManager: false, outcome: CallOutcome.dnc, note: 'owner asked not to be called' });

  const after = await load(ds);
  assert.equal(after.at('101', 'Marina').state, PropertyState.dnc, 'called unit is DNC');
  assert.equal(after.at('102', 'Marina').state, PropertyState.dnc, 'same-area sibling (pooled) is DNC');
  assert.notEqual(after.at('201', 'JVC').state, PropertyState.dnc, 'a different area of the same owner is NOT DNC');
  void B; void C;
});

test('the sweep keeps the group while any unit is worked, and recycles it together when abandoned', async () => {
  // KEEP: A worked (future deadline), B lapsed → B stays with X, renewed.
  let ds = await seed(OWNER_MAP);
  let g = await load(ds);
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=?, assignment_expires_at=(UTC_TIMESTAMP()+INTERVAL 2 DAY) WHERE id=?`, [brokerX, g.at('101', 'Marina').id]);
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=?, assignment_expires_at=(UTC_TIMESTAMP()-INTERVAL 1 DAY) WHERE id=?`, [brokerX, g.at('102', 'Marina').id]);
  await sweepLapsed();
  g = await load(ds);
  assert.equal(g.at('102', 'Marina').state, PropertyState.assigned, 'lapsed sibling kept while the owner is worked');
  assert.equal(g.at('102', 'Marina').assignedTo, brokerX);

  // ABANDONED: both lapsed → whole group returns to the pool together.
  ds = await seed(OWNER_MAP);
  g = await load(ds);
  await pool.query(`UPDATE properties SET state='assigned', assigned_to=?, assignment_expires_at=(UTC_TIMESTAMP()-INTERVAL 1 DAY) WHERE id IN (?,?)`, [brokerX, g.at('101', 'Marina').id, g.at('102', 'Marina').id]);
  await sweepLapsed();
  g = await load(ds);
  assert.equal(g.at('101', 'Marina').state, PropertyState.pool, 'abandoned group recycled (A)');
  assert.equal(g.at('102', 'Marina').state, PropertyState.pool, 'abandoned group recycled (B) — together');
});

test("a manager's interested call with keepInPool records the outcome but leaves the unit in the pool", async () => {
  const ds = await seed(OWNER_MAP);
  const A = (await load(ds)).at('101', 'Marina'); // pooled
  await logCall({ propertyIds: [A.id], brokerId: manager, isManager: true, outcome: CallOutcome.interestedRent, note: 'keen, keep in pool', keepInPool: true });
  const a = (await load(ds)).at('101', 'Marina');
  assert.equal(a.state, PropertyState.pool, 'unit stays in the pool');
  assert.equal(a.assignedTo, undefined, 'still unassigned');
  assert.equal(a.lastOutcome, CallOutcome.interestedRent, 'the interest is recorded on the record');
});

test('manager handoff: assign the group to a broker, then an interested call → that broker\'s portfolio', async () => {
  const ds = await seed(OWNER_MAP);
  const g = await load(ds);
  const A = g.at('101', 'Marina'); // pooled; owner O also has 102 in Marina
  // The dialog assigns the owner-area group to X, then logs the interested call.
  await assignProperties([A.id], brokerX, manager);
  await logCall({ propertyIds: [A.id], brokerId: manager, isManager: true, outcome: CallOutcome.interestedRent, note: 'interested to rent' });
  const after = await load(ds);
  assert.equal(after.at('101', 'Marina').state, PropertyState.portfolio, 'worked unit → portfolio');
  assert.equal(after.at('101', 'Marina').assignedTo, brokerX, 'held by the chosen broker');
  assert.equal(after.at('102', 'Marina').assignedTo, brokerX, 'the owner\'s same-area sibling moved to that broker too');
});

test.after(async () => { await closePool(); });
