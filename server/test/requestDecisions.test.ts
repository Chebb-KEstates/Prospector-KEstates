import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool';
import { saveProperties, findPropertiesByIds } from '../src/repositories/propertyRepo';
import { insertRequest, findRequestById, listRequests } from '../src/repositories/requestRepo';
import { insertUser } from '../src/repositories/userRepo';
import {
  approveRequest, denyRequest, decideRequestUnits, assignProperties,
} from '../src/services/assignmentService';
import {
  BatchRequest, OwnerInfo, Property, PropertyState, RequestStatus, UnitDecision, kOrgId,
} from '../../src/types/models';
import { AppUser, UserRole } from '../../src/types/user';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newPropertyId, newRequestId, newUserId } from '../src/domain/ids';
import { setOpenAccessForTests } from '../src/domain/access';
import { ApiError } from '../src/http/errors';

/**
 * Per-unit decisions on a hand-picked request: the manager approves or denies
 * SOME of a broker's requested units, the rest stay pending, and the request
 * closes once nothing is left undecided. The owner rules (never split an owner's
 * same-area units across brokers) still apply to every grant.
 */

let manager: string, brokerX: string, brokerY: string;

// These guard the ASSIGNED model (OPEN_ACCESS = false) — the path a revert relies on.
test.before(async () => {
  setOpenAccessForTests(false);
  manager = newUserId(); brokerX = newUserId(); brokerY = newUserId();
  const mk = (id: string, name: string, role: UserRole) => insertUser({
    user: new AppUser(id, name, `${id}@test.local`, role, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await mk(manager, 'Manager', UserRole.manager);
  await mk(brokerX, 'Broker X', UserRole.broker);
  await mk(brokerY, 'Broker Y', UserRole.broker);
});

test.after(async () => { setOpenAccessForTests(null); await closePool(); });

async function wipe() {
  await pool.query('DELETE FROM requests WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM calls WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
}

function unit(unitNumber: string, ownerName: string, phone: string, community = 'Maple'): Property {
  const unitKey = ImportPipeline.unitKeyFor({ community, building: 'Tower', unitNumber })!;
  const now = new Date().toISOString();
  return new Property(
    newPropertyId(), kOrgId, '', PropertyState.pool, unitKey, community,
    undefined, 'Tower', unitNumber, undefined, 'Villa',
    4, 2500, undefined, undefined, undefined, 0,
    undefined, undefined, undefined,
    new OwnerInfo(ownerName, phone), now, now,
  );
}

/** Seed units and a hand-picked request by `brokerX` for all of them. */
async function seed(units: Property[], requested = units) {
  await wipe();
  await saveProperties(units);
  const req = new BatchRequest(
    newRequestId(), kOrgId, brokerX, 'Maple', undefined,
    requested.length, requested.map(u => u.id), undefined, new Date().toISOString(),
  );
  await insertRequest(req);
  return req.id;
}

async function stateOf(id: string) {
  const [p] = await findPropertiesByIds([id]);
  return { state: p.state, assignedTo: p.assignedTo };
}

async function expectApiError(fn: () => Promise<unknown>, status: number) {
  await assert.rejects(fn, (e: unknown) => e instanceof ApiError && e.statusCode === status);
}

// Four distinct owners — no owner-linking in play.
const four = () => [
  unit('1', 'Owner A', '971500000001'),
  unit('2', 'Owner B', '971500000002'),
  unit('3', 'Owner C', '971500000003'),
  unit('4', 'Owner D', '971500000004'),
];

test('approving SOME units grants only those; the request stays pending', async () => {
  const [a, b, c, d] = four();
  const id = await seed([a, b, c, d]);

  const r = await decideRequestUnits(id, [a.id, b.id], 'approve', manager);
  assert.equal(r.granted, 2);
  assert.equal(r.unavailable, 0);
  assert.equal(r.request.status, RequestStatus.pending);
  assert.equal(r.request.grantedCount, 2);
  assert.equal(r.request.decidedAt, undefined);

  assert.deepEqual(await stateOf(a.id), { state: PropertyState.assigned, assignedTo: brokerX });
  assert.deepEqual(await stateOf(b.id), { state: PropertyState.assigned, assignedTo: brokerX });
  assert.deepEqual(await stateOf(c.id), { state: PropertyState.pool, assignedTo: undefined });

  // Decisions survive a fresh read (the hydration path the list uses).
  const back = (await findRequestById(id))!;
  assert.equal(back.status, RequestStatus.pending);
  assert.deepEqual(back.unitDecisions, { [a.id]: UnitDecision.granted, [b.id]: UnitDecision.granted });
  assert.deepEqual(back.pendingUnitIds.sort(), [c.id, d.id].sort());
  const [row] = await pool.query<any[]>('SELECT decided_by FROM requests WHERE id = ?', [id]);
  assert.equal(row[0].decided_by, null, 'not decided while units are pending');
  // Still counted as pending (drives the manager's badge).
  assert.ok((await listRequests({ status: RequestStatus.pending })).some(x => x.id === id));
});

test('denying SOME units leaves them in the pool; deciding the rest closes the request', async () => {
  const [a, b, c, d] = four();
  const id = await seed([a, b, c, d]);

  const r1 = await decideRequestUnits(id, [a.id], 'deny', manager);
  assert.equal(r1.denied, 1);
  assert.equal(r1.request.status, RequestStatus.pending);
  assert.deepEqual(await stateOf(a.id), { state: PropertyState.pool, assignedTo: undefined });

  await decideRequestUnits(id, [b.id, c.id], 'approve', manager);
  const r3 = await decideRequestUnits(id, [d.id], 'deny', manager);
  assert.equal(r3.request.status, RequestStatus.approved, 'closes approved when anything was granted');
  assert.equal(r3.request.grantedCount, 2);
  assert.ok(r3.request.decidedAt);

  const back = (await findRequestById(id))!;
  assert.equal(back.status, RequestStatus.approved);
  assert.equal(back.grantedCount, 2);
  assert.equal(back.pendingUnitIds.length, 0);
  const [row] = await pool.query<any[]>('SELECT decided_by FROM requests WHERE id = ?', [id]);
  assert.equal(row[0].decided_by, manager);
});

test('denying every unit closes the request as denied', async () => {
  const [a, b] = four();
  const id = await seed([a, b]);
  await decideRequestUnits(id, [a.id], 'deny', manager);
  const r = await decideRequestUnits(id, [b.id], 'deny', manager);
  assert.equal(r.request.status, RequestStatus.denied);
  assert.equal(r.request.grantedCount, 0);
});

test('invalid selections are rejected and change nothing', async () => {
  const [a, b, c] = four();
  const id = await seed([a, b], [a, b]);
  await saveProperties([c]); // exists, but not part of the request

  await decideRequestUnits(id, [a.id], 'deny', manager);
  await expectApiError(() => decideRequestUnits(id, [a.id], 'approve', manager), 409); // already decided
  await expectApiError(() => decideRequestUnits(id, [b.id, a.id], 'deny', manager), 409); // one already decided
  await expectApiError(() => decideRequestUnits(id, [c.id], 'approve', manager), 409); // not in request
  await expectApiError(() => decideRequestUnits(id, [], 'approve', manager), 400);
  await expectApiError(() => decideRequestUnits('nope', [a.id], 'approve', manager), 404);

  // Nothing above moved b or c, and a stays denied.
  assert.deepEqual(await stateOf(b.id), { state: PropertyState.pool, assignedTo: undefined });
  assert.deepEqual(await stateOf(c.id), { state: PropertyState.pool, assignedTo: undefined });
  const back = (await findRequestById(id))!;
  assert.deepEqual(back.unitDecisions, { [a.id]: UnitDecision.denied });

  // Once closed, no more per-unit decisions.
  await decideRequestUnits(id, [b.id], 'deny', manager);
  await expectApiError(() => decideRequestUnits(id, [b.id], 'approve', manager), 409);
});

test('duplicate ids in one selection are decided once', async () => {
  const [a, b] = four();
  const id = await seed([a, b]);
  const r = await decideRequestUnits(id, [a.id, a.id], 'approve', manager);
  assert.equal(r.decided, 1);
  assert.equal(r.granted, 1);
  assert.equal(r.request.status, RequestStatus.pending);
});

test('a selected unit that left the pool is marked unavailable, the rest are granted', async () => {
  const [a, b, c] = four();
  const id = await seed([a, b, c]);
  await assignProperties([b.id], brokerY, manager); // b taken meanwhile

  const r = await decideRequestUnits(id, [a.id, b.id], 'approve', manager);
  assert.equal(r.granted, 1);
  assert.equal(r.unavailable, 1);
  assert.deepEqual(await stateOf(b.id), { state: PropertyState.assigned, assignedTo: brokerY }, 'never stolen');
  const back = (await findRequestById(id))!;
  assert.equal(back.unitDecisions[b.id], UnitDecision.unavailable);
  assert.equal(back.unitDecisions[a.id], UnitDecision.granted);
  assert.equal(back.status, RequestStatus.pending, 'c still undecided');
});

test("an owner held by another broker in the area is not split — unit marked unavailable", async () => {
  // a1 + a2: same owner, same area. a2 is with broker Y; the request has a1 only.
  const a1 = unit('11', 'Owner A', '971500000011');
  const a2 = unit('12', 'Owner A', '971500000011');
  const id = await seed([a1, a2], [a1]);
  await assignProperties([a2.id], brokerY, manager);
  // assignProperties expands to the whole group, so put a1 back into the pool.
  await pool.query(`UPDATE properties SET state = 'pool', assigned_to = NULL WHERE id = ?`, [a1.id]);

  const r = await decideRequestUnits(id, [a1.id], 'approve', manager);
  assert.equal(r.granted, 0);
  assert.equal(r.unavailable, 1);
  assert.equal(r.request.status, RequestStatus.denied, 'nothing granted, nothing pending');
  assert.deepEqual(await stateOf(a1.id), { state: PropertyState.pool, assignedTo: undefined });
});

test('approving one unit brings its same-owner same-area units, recorded as granted', async () => {
  // o1 + o2 share an owner in one area (both requested); o3 is the same owner's
  // pooled unit NOT in the request; p is someone else.
  const o1 = unit('21', 'Owner O', '971500000021');
  const o2 = unit('22', 'Owner O', '971500000021');
  const o3 = unit('23', 'Owner O', '971500000021');
  const p = unit('24', 'Owner P', '971500000024');
  const id = await seed([o1, o2, o3, p], [o1, o2, p]);

  const r = await decideRequestUnits(id, [o1.id], 'approve', manager);
  assert.equal(r.granted, 1);
  assert.equal(r.linkedInRequest, 1, 'o2 came along');
  assert.equal(r.ownerLinkedExtra, 1, 'o3 came along from outside the request');
  for (const u of [o1, o2, o3]) {
    assert.deepEqual(await stateOf(u.id), { state: PropertyState.assigned, assignedTo: brokerX });
  }
  const back = (await findRequestById(id))!;
  assert.equal(back.unitDecisions[o2.id], UnitDecision.granted);
  assert.deepEqual(back.pendingUnitIds, [p.id]);
  assert.equal(back.grantedCount, 2);
});

test('whole-request Approve after partial decisions approves only the undecided units', async () => {
  const [a, b, c, d] = four();
  const id = await seed([a, b, c, d]);
  await decideRequestUnits(id, [a.id], 'deny', manager);

  const r = await approveRequest(id, manager);
  assert.equal(r.considered, 3);
  assert.equal(r.granted, 3);
  assert.equal(r.request.status, RequestStatus.approved);
  assert.equal(r.request.grantedCount, 3);
  assert.deepEqual(await stateOf(a.id), { state: PropertyState.pool, assignedTo: undefined }, 'the denial stands');
  assert.equal((await findRequestById(id))!.unitDecisions[a.id], UnitDecision.denied);
});

test('whole-request Deny after a partial approval keeps the grant and closes as approved', async () => {
  const [a, b, c] = four();
  const id = await seed([a, b, c]);
  await decideRequestUnits(id, [a.id], 'approve', manager);

  const decided = await denyRequest(id, manager);
  assert.equal(decided.status, RequestStatus.approved);
  assert.equal(decided.grantedCount, 1);
  assert.deepEqual(await stateOf(a.id), { state: PropertyState.assigned, assignedTo: brokerX });
  assert.deepEqual(await stateOf(b.id), { state: PropertyState.pool, assignedTo: undefined });
  const back = (await findRequestById(id))!;
  assert.equal(back.unitDecisions[b.id], UnitDecision.denied);
  assert.equal(back.unitDecisions[c.id], UnitDecision.denied);
});

test('whole-request Approve/Deny on an undecided hand-picked request still work as before', async () => {
  const [a, b, c, d] = four();
  const id1 = await seed([a, b]);
  const r = await approveRequest(id1, manager);
  assert.equal(r.granted, 2);
  assert.equal(r.request.status, RequestStatus.approved);

  const id2 = await seed([c, d]);
  const dn = await denyRequest(id2, manager);
  assert.equal(dn.status, RequestStatus.denied);
  assert.equal(dn.grantedCount, 0);
  await expectApiError(() => approveRequest(id2, manager), 409);
});

test('a bulk (non-hand-picked) request cannot be decided per unit, but approves as a whole', async () => {
  const [a, b, c] = four();
  await wipe();
  await saveProperties([a, b, c]);
  const req = new BatchRequest(newRequestId(), kOrgId, brokerX, 'Maple', undefined, 2, [], undefined, new Date().toISOString());
  await insertRequest(req);

  await expectApiError(() => decideRequestUnits(req.id, [a.id], 'approve', manager), 400);
  const r = await approveRequest(req.id, manager);
  assert.equal(r.granted, 2);
  assert.equal(r.considered, 2);
  assert.equal(r.request.status, RequestStatus.approved);
});

test('two managers deciding the same units at once: one wins, nothing is double-decided', async () => {
  const [a, b, c] = four();
  const id = await seed([a, b, c]);

  const results = await Promise.allSettled([
    decideRequestUnits(id, [a.id, b.id], 'approve', manager),
    decideRequestUnits(id, [b.id, c.id], 'deny', manager),
  ]);
  const ok = results.filter(r => r.status === 'fulfilled');
  const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof ApiError && failed[0].reason.statusCode === 409);

  const back = (await findRequestById(id))!;
  const decidedB = back.unitDecisions[b.id];
  if (decidedB === UnitDecision.granted) {
    assert.deepEqual(await stateOf(b.id), { state: PropertyState.assigned, assignedTo: brokerX });
  } else {
    assert.equal(decidedB, UnitDecision.denied);
    assert.deepEqual(await stateOf(b.id), { state: PropertyState.pool, assignedTo: undefined });
  }
});

test('every per-unit decision is audited', async () => {
  const [a, b] = four();
  const id = await seed([a, b]);
  await decideRequestUnits(id, [a.id], 'approve', manager);
  await decideRequestUnits(id, [b.id], 'deny', manager);
  const [rows] = await pool.query<any[]>(
    `SELECT action, detail FROM audit WHERE detail LIKE ? ORDER BY at`, [`Request ${id}:%`],
  );
  assert.deepEqual(rows.map(r => r.action), ['approve', 'deny']);
  assert.match(rows[0].detail, /granted 1 of 1 selected — 1 still pending/);
  assert.match(rows[1].detail, /denied 1 unit\(s\) — request closed/);
});
